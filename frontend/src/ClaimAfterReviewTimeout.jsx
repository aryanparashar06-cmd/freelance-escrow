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
  if (reason?.includes("Only freelancer can claim")) {
    return "Only the assigned freelancer can claim this payment. Select that wallet in MetaMask.";
  }
  if (reason?.includes("Work is not submitted")) {
    return "The job must still be SUBMITTED. Released, refunded, or disputed jobs cannot use this claim.";
  }
  if (reason?.includes("Review period has not passed")) {
    return "The review period has not passed on the blockchain. Load Job again after a later block is mined.";
  }
  if (reason?.includes("Job does not exist")) return "Job does not exist. Check the Job ID.";
  if (reason?.includes("Payment transfer failed")) {
    return "Payment transfer failed. The claim was reverted and the escrow remains held by the contract.";
  }
  return reason || "Unable to complete the request. Check MetaMask and the local node.";
}

function parseJobId(value) {
  if (!/^[0-9]+$/.test(value.trim())) throw new Error("Enter a valid positive whole-number Job ID.");
  const id = BigInt(value.trim());
  if (id === 0n || id > ethers.MaxUint256) {
    throw new Error("Enter a Job ID between 1 and the maximum uint256 value.");
  }
  return id;
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? `${timestamp} (Unix seconds)` : date.toLocaleString();
}

function formatDuration(seconds) {
  const days = Number(seconds) / 86400;
  return Number.isInteger(days) ? `${days} days` : `${seconds.toString()} seconds`;
}

export default function ClaimAfterReviewTimeout({ account }) {
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const revision = useRef(0);
  const pending = useRef(false);

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
    if (!window.ethereum || !account) {
      throw new Error("Connect MetaMask before loading or claiming payment.");
    }
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
    // Read every eligibility value at one mined block for a consistent result.
    const block = await provider.getBlock(blockTag);
    if (!block) throw new Error("Unable to read the blockchain time. Check the local node and load again.");
    const [result, reviewPeriod] = await Promise.all([
      contract.jobs(id, { blockTag: block.number }),
      contract.REVIEW_PERIOD({ blockTag: block.number }),
    ]);
    if (result.state === 0n) throw new Error("Job does not exist");
    const submittedAt = result.submittedAt;
    return {
      id: id.toString(),
      client: result.client,
      freelancer: result.freelancer,
      title: result.title,
      amount: result.amount,
      submittedAt,
      state: result.state,
      reviewPeriod,
      eligibleAt: submittedAt + reviewPeriod,
      blockchainTime: BigInt(block.timestamp),
    };
  }

  async function runAction(claim) {
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
      if (claim) {
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if (details.state !== 3n) {
          throw new Error("The job must still be SUBMITTED. Released, refunded, or disputed jobs cannot use this claim.");
        }
        if (details.freelancer.toLowerCase() !== account.toLowerCase()) {
          throw new Error("Only the assigned freelancer can claim this payment. Select that wallet in MetaMask.");
        }
        if (details.blockchainTime <= details.eligibleAt) {
          throw new Error("Review period has not passed");
        }
        const signer = await provider.getSigner(account);
        if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) {
          throw new Error("Wrong network. Select Hardhat Localhost (Chain ID: 31337).");
        }
        if (current !== revision.current) return;
        if ((await signer.getAddress()).toLowerCase() !== details.freelancer.toLowerCase()) {
          throw new Error("Select the assigned freelancer wallet in MetaMask.");
        }
        if (current !== revision.current) return;
        // UI checks aid usability; the Solidity contract remains authoritative.
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Waiting for MetaMask confirmation...");
        const tx = await contract.claimAfterReviewTimeout(id);
        if (current === revision.current) {
          setHash(tx.hash);
          setStatus("Transaction submitted. Waiting for blockchain confirmation...");
        }
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setStatus(`Job ${id} payment claimed successfully. Escrow released to the freelancer. State: RELEASED.`);
      }
      try {
        const details = await readJob(provider, id, confirmedBlock);
        if (current === revision.current) setJob(details);
      } catch (err) {
        if (current === revision.current) {
          setError(`${claim ? "Payment claimed, but details could not be refreshed. Load Job again: " : ""}${errorMessage(err)}`);
        }
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

  const eligible = job && job.state === 3n && job.blockchainTime > job.eligibleAt;

  return (
    <section className="form-panel accept-job-panel" aria-labelledby="review-timeout-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR FREELANCERS</p><h2 id="review-timeout-heading">Claim After Review Timeout</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">If the client neither approves nor disputes correctly submitted work during the review period, the assigned freelancer can release the escrow payment.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="review-timeout-job-id">Job ID</label>
            <input id="review-timeout-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
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
          <div><dt>Amount</dt><dd>{ethers.formatEther(job.amount)} ETH</dd></div>
          <div><dt>Submitted at (local display)</dt><dd>{formatTime(job.submittedAt)}</dd></div>
          <div><dt>Review period</dt><dd>{formatDuration(job.reviewPeriod)} ({job.reviewPeriod.toString()} seconds)</dd></div>
          <div><dt>Eligible claim time (local display)</dt><dd>{formatTime(job.eligibleAt)}</dd></div>
          <div><dt>Latest blockchain time (local display)</dt><dd>{formatTime(job.blockchainTime)}</dd></div>
          <div><dt>Current state</dt><dd>{STATES[Number(job.state)] ?? "UNKNOWN"}</dd></div>
          <div><dt>Eligibility</dt><dd>{eligible ? "Eligible to claim" : "Not yet eligible"}</dd></div>
        </dl>
      )}
      <button className="create-button accept-job-button" type="button"
        disabled={!account || busy || !job || !eligible || job.freelancer.toLowerCase() !== account.toLowerCase()}
        onClick={() => void runAction(true)}>
        Claim Payment After Review Timeout
      </button>
      {job && job.state !== 3n && <p className="form-note">The job must remain SUBMITTED. A DISPUTED job must be resolved by its arbitrator and cannot use this timeout claim.</p>}
      {job && job.state === 3n && job.blockchainTime <= job.eligibleAt
        && <p className="form-note">The review period has not passed on the blockchain. Eligibility requires a timestamp strictly after the eligible claim time.</p>}
      {job && account && job.freelancer.toLowerCase() !== account.toLowerCase()
        && <p className="form-note">Select the assigned freelancer wallet in MetaMask to claim payment.</p>}
      <p className="form-note">This prevents correctly submitted work from remaining unpaid indefinitely. Eligibility uses mined blockchain time; use Load Job again after a later block is mined. Claiming requires MetaMask approval and local ETH for gas.</p>
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
