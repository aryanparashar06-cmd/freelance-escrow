import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import "./AcceptJob.css";

const STATES = ["NONE", "FUNDED", "ACCEPTED", "SUBMITTED", "DISPUTED", "RELEASED", "REFUNDED"];

function errorMessage(err) {
  if (err.code === "ACTION_REJECTED" || err.code === 4001
    || err.info?.error?.code === 4001 || err.error?.code === 4001) {
    return "Transaction cancelled in MetaMask. You can try again.";
  }
  const reason = err.reason || err.info?.error?.message || err.shortMessage || err.message;
  if (reason?.includes("Only client can request refund")) return "Only the client can request a refund for this job. Select that wallet in MetaMask.";
  if (reason?.includes("Refund not allowed")) return "Refunds require the job to be FUNDED or ACCEPTED; submitted work cannot use this refund.";
  if (reason?.includes("Job does not exist")) return "Job does not exist. Check the Job ID.";
  if (reason?.includes("Refund transfer failed")) return "Refund transfer failed. The refund was reverted and the escrow remains held by the contract.";
  if (reason?.includes("Deadline has not passed")) return "The deadline has not passed on the blockchain. Load Job again after a later block is mined.";
  return reason || "Unable to complete the request. Check MetaMask and the local node.";
}

function parseJobId(value) {
  if (!/^[0-9]+$/.test(value.trim())) throw new Error("Enter a valid positive whole-number Job ID.");
  const id = BigInt(value.trim());
  if (id === 0n || id > ethers.MaxUint256) throw new Error("Enter a Job ID between 1 and the maximum uint256 value.");
  return id;
}

function formatDeadline(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? `${timestamp} (Unix seconds)` : date.toLocaleString();
}

export default function RefundAfterDeadline({ account }) {
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const revision = useRef(0);
  const pending = useRef(false);

  // Discard stale details and replies when the wallet context changes.
  useEffect(() => {
    const wallet = window.ethereum;
    const requests = revision;
    function clearDetails() {
      requests.current++;
      setJob(null);
      setError("");
      setStatus("");
      setHash("");
    }
    wallet?.on("accountsChanged", clearDetails);
    wallet?.on("chainChanged", clearDetails);
    return () => {
      requests.current++;
      wallet?.removeListener("accountsChanged", clearDetails);
      wallet?.removeListener("chainChanged", clearDetails);
    };
  }, []);

  async function getProvider() {
    if (!window.ethereum || !account) throw new Error("Connect MetaMask before loading or requesting a refund.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== LOCAL_CHAIN_ID) {
      throw new Error("Wrong network. Select Hardhat Localhost (Chain ID: 31337).");
    }
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts.length || accounts[0].toLowerCase() !== account.toLowerCase()) {
      throw new Error("Wallet changed or disconnected. Reconnect and try again.");
    }
    if (await provider.getCode(ESCROW_ADDRESS) === "0x") {
      throw new Error("No contract found. Check the local node and deployment address.");
    }
    return provider;
  }

  async function readJob(provider, id, blockTag = "latest") {
    const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
    // Use the same mined block for the job and its blockchain timestamp.
    const block = await provider.getBlock(blockTag);
    if (!block) throw new Error("Unable to read the blockchain time. Check the local node and load again.");
    const result = await contract.jobs(id, { blockTag: block.number });
    if (result.state === 0n) throw new Error("Job does not exist");
    return { id: id.toString(), client: result.client, freelancer: result.freelancer,
      arbitrator: result.arbitrator, title: result.title, amount: result.amount,
      deadline: result.deadline, blockchainTime: BigInt(block.timestamp), state: result.state };
  }

  async function runAction(refund) {
    if (pending.current) return;
    pending.current = true;
    const current = ++revision.current;
    setBusy(true);
    setError("");
    setStatus("");
    setHash("");
    setJob(null);
    try {
      const id = parseJobId(jobId);
      const provider = await getProvider();
      if (current !== revision.current) return;
      let confirmedBlock = "latest";
      if (refund) {
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if ((details.state !== 1n && details.state !== 2n)) throw new Error("Refunds require the job to be FUNDED or ACCEPTED; submitted work cannot use this refund.");
        if (details.client.toLowerCase() !== account.toLowerCase()) {
          throw new Error("Only the client can request a refund. Select that wallet in MetaMask.");
        }
        if (details.blockchainTime <= details.deadline) {
          throw new Error("Deadline has not passed");
        }
        const signer = await provider.getSigner(account);
        if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) {
          throw new Error("Wrong network. Select Hardhat Localhost (Chain ID: 31337).");
        }
        if (current !== revision.current) return;
        if ((await signer.getAddress()).toLowerCase() !== details.client.toLowerCase()) {
          throw new Error("Select the client wallet in MetaMask.");
        }
        if (current !== revision.current) return;
        // These UI checks help usability; Solidity remains the security authority.
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Waiting for MetaMask confirmation...");
        const tx = await contract.refundAfterDeadline(id);
        if (current === revision.current) {
          setHash(tx.hash);
          setStatus("Transaction submitted. Waiting for blockchain confirmation...");
        }
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setStatus(`Job ${id} refunded successfully. Escrow returned to the client. State: REFUNDED.`);
      }
      // Keep transaction success separate from a failed details refresh.
      try {
        // Read the confirmed block to avoid a cached pre-refund result.
        const details = await readJob(provider, id, confirmedBlock);
        if (current === revision.current) setJob(details);
      } catch (err) {
        if (current === revision.current) setError(`${refund ? "Refund confirmed, but details could not be refreshed. Load Job again: " : ""}${errorMessage(err)}`);
      }
    } catch (err) {
      if (current === revision.current) {
        setStatus("");
        setError(errorMessage(err));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="form-panel accept-job-panel" aria-labelledby="refund-deadline-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR CLIENTS</p><h2 id="refund-deadline-heading">Refund After Deadline</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">The client can reclaim escrow after the deadline only if the freelancer has not submitted work. The job must still be FUNDED or ACCEPTED.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="refund-deadline-job-id">Job ID</label>
            <input id="refund-deadline-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
              onChange={(event) => { revision.current++; setJobId(event.target.value); setJob(null); setError(""); setStatus(""); setHash(""); }} />
          </div>
          <button className="create-button" type="submit" disabled={!account || busy}>Load Job</button>
        </fieldset>
      </form>
      {job && (
        <dl className="accept-job-details">
          <div><dt>Job ID</dt><dd>{job.id}</dd></div>
          <div><dt>Title</dt><dd>{job.title}</dd></div>
          <div><dt>Client address</dt><dd>{job.client}</dd></div>
          <div><dt>Freelancer address</dt><dd>{job.freelancer}</dd></div>
          <div><dt>Arbitrator address</dt><dd>{job.arbitrator}</dd></div>
          <div><dt>Amount</dt><dd>{ethers.formatEther(job.amount)} ETH</dd></div>
          <div><dt>Deadline (local time)</dt><dd>{formatDeadline(job.deadline)}</dd></div>
          <div><dt>Current state</dt><dd>{STATES[Number(job.state)] ?? "UNKNOWN"}</dd></div>
          <div><dt>Latest checked blockchain time (local display)</dt><dd>{formatDeadline(job.blockchainTime)}</dd></div>
        </dl>
      )}
      <button className="create-button accept-job-button" type="button"
        disabled={!account || busy || !job || (job.state !== 1n && job.state !== 2n) || job.client.toLowerCase() !== account.toLowerCase() || job.blockchainTime <= job.deadline}
        onClick={() => void runAction(true)}>
        Refund After Deadline
      </button>
      {job && (job.state !== 1n && job.state !== 2n) && <p className="form-note">Refunds require the job to be FUNDED or ACCEPTED; submitted work cannot use this refund.</p>}
      {job && job.blockchainTime <= job.deadline && <p className="form-note">The deadline has not passed on the blockchain. Refund requires a block timestamp strictly after the deadline.</p>}
      {job && account && job.client.toLowerCase() !== account.toLowerCase()
        && <p className="form-note">Select the client wallet in MetaMask to request a refund.</p>}
      <p className="form-note">Eligibility uses the latest mined block, not your computer clock. Click Load Job to refresh the blockchain time after a new block is mined. Refunding returns escrow to the client and requires MetaMask approval plus local ETH for gas.</p>
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
