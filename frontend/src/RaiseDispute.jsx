import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, WRONG_NETWORK_MESSAGE, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import "./AcceptJob.css";

const STATES = ["NONE", "FUNDED", "ACCEPTED", "SUBMITTED", "DISPUTED", "RELEASED", "REFUNDED"];

function errorMessage(err) {
  if (err.code === "ACTION_REJECTED" || err.code === 4001
    || err.info?.error?.code === 4001 || err.error?.code === 4001) {
    return "Transaction cancelled in MetaMask. You can try again.";
  }
  const reason = err.reason || err.info?.error?.message || err.shortMessage || err.message;
  if (reason?.includes("Only client or freelancer can dispute")) return "Only the client or assigned freelancer can raise a dispute. Select one of those wallets in MetaMask.";
  if (reason?.includes("Dispute not allowed")) return "A dispute can only be raised when the job is SUBMITTED.";
  if (reason?.includes("Job does not exist")) return "Job does not exist. Check the Job ID.";
  return reason || "Unable to complete the request. Check MetaMask and the local node.";
}

function isParty(job, address) {
  const wallet = address.toLowerCase();
  return job.client.toLowerCase() === wallet || job.freelancer.toLowerCase() === wallet;
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

export default function RaiseDispute({ account }) {
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
    if (!window.ethereum || !account) throw new Error("Connect MetaMask before loading or raising a dispute.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== LOCAL_CHAIN_ID) {
      throw new Error(WRONG_NETWORK_MESSAGE);
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
    const result = await contract.jobs(id, { blockTag });
    if (result.state === 0n) throw new Error("Job does not exist");
    return { id: id.toString(), client: result.client, freelancer: result.freelancer,
      arbitrator: result.arbitrator, title: result.title, amount: result.amount,
      deadline: result.deadline, workProof: result.workProof, state: result.state };
  }

  async function runAction(dispute) {
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
      if (dispute) {
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if (details.state !== 3n) throw new Error("A dispute can only be raised when the job is SUBMITTED.");
        if (!isParty(details, account)) {
          throw new Error("Only the client or assigned freelancer can raise a dispute. Select one of those wallets in MetaMask.");
        }
        const signer = await provider.getSigner(account);
        if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) {
          throw new Error(WRONG_NETWORK_MESSAGE);
        }
        if (current !== revision.current) return;
        if (!isParty(details, await signer.getAddress())) {
          throw new Error("Select the client or assigned freelancer wallet in MetaMask.");
        }
        if (current !== revision.current) return;
        // These UI checks help usability; Solidity remains the security authority.
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Waiting for MetaMask confirmation...");
        const tx = await contract.raiseDispute(id);
        if (current === revision.current) {
          setHash(tx.hash);
          setStatus("Transaction submitted. Waiting for blockchain confirmation...");
        }
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setStatus(`Transaction confirmed. Job ${id} dispute raised successfully. State: DISPUTED. The designated arbitrator must resolve the dispute.`);
      }
      // Keep transaction success separate from a failed details refresh.
      try {
        // Read the confirmed block to avoid a cached pre-dispute result.
        const details = await readJob(provider, id, confirmedBlock);
        if (current === revision.current) setJob(details);
      } catch (err) {
        if (current === revision.current) setError(`${dispute ? "Dispute raised, but details could not be refreshed. Load Job again: " : ""}${errorMessage(err)}`);
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
    <section className="form-panel accept-job-panel" aria-labelledby="raise-dispute-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR CLIENTS &amp; FREELANCERS</p><h2 id="raise-dispute-heading">Raise Dispute</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">Load a submitted job and review its work proof. The client or assigned freelancer can raise a dispute for the designated arbitrator to resolve.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="raise-dispute-job-id">Job ID</label>
            <input id="raise-dispute-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
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
          <div><dt>Submitted work proof</dt><dd>{job.workProof || "No work proof stored."}</dd></div>
        </dl>
      )}
      <button className="create-button accept-job-button" type="button"
        disabled={!account || busy || !job || job.state !== 3n || !isParty(job, account)}
        onClick={() => void runAction(true)}>
        Raise Dispute
      </button>
      {job && job.state !== 3n && <p className="form-note">A dispute can only be raised when the job is SUBMITTED.</p>}
      {job && account && !isParty(job, account)
        && <p className="form-note">Select the client or assigned freelancer wallet in MetaMask to raise a dispute.</p>}
      <p className="form-note">Once a dispute is raised, normal approval and the review-timeout claim are no longer available. The designated arbitrator must resolve the dispute. Raising a dispute does not release payment; MetaMask approval and local ETH for gas are required.</p>
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
