import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, WRONG_NETWORK_MESSAGE, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import "./AcceptJob.css";
import "./ResolveDispute.css";

const DECISIONS = { REFUND: 1, RELEASE: 2 };
const STATES = ["NONE", "FUNDED", "ACCEPTED", "SUBMITTED", "DISPUTED", "RELEASED", "REFUNDED"];

function errorMessage(err) {
  if (err.code === "ACTION_REJECTED" || err.code === 4001
    || err.info?.error?.code === 4001 || err.error?.code === 4001) {
    return "Transaction cancelled in MetaMask. You can try again.";
  }
  const reason = err.reason || err.info?.error?.message || err.shortMessage || err.message;
  if (reason?.includes("Only arbitrator can resolve")) return "Only the designated arbitrator can resolve this dispute. Select that wallet in MetaMask.";
  if (reason?.includes("Job is not disputed")) return "A dispute can only be resolved when the job is DISPUTED.";
  if (reason?.includes("Job does not exist")) return "Job does not exist. Check the Job ID.";
  if (reason?.includes("Invalid decision")) return "Choose REFUND CLIENT or RELEASE TO FREELANCER.";
  if (reason?.includes("Transfer failed")) return "ETH transfer failed. Resolution was reverted; the escrow remains held by the contract.";
  return reason || "Unable to complete the request. Check MetaMask and the local node.";
}

function isArbitrator(job, address) {
  const wallet = address.toLowerCase();
  return job.arbitrator.toLowerCase() === wallet;
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

export default function ResolveDispute({ account }) {
  const [jobId, setJobId] = useState("");
  const [decision, setDecision] = useState(null);
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
      setDecision(null);
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
    if (!window.ethereum || !account) throw new Error("Connect MetaMask before loading or resolving a dispute.");
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

  async function runAction(resolve) {
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
      if (resolve) {
        if (decision !== DECISIONS.REFUND && decision !== DECISIONS.RELEASE) {
          throw new Error("Choose REFUND CLIENT or RELEASE TO FREELANCER.");
        }
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if (details.state !== 4n) throw new Error("A dispute can only be resolved when the job is DISPUTED.");
        if (!isArbitrator(details, account)) {
          throw new Error("Only the designated arbitrator can resolve this dispute. Select that wallet in MetaMask.");
        }
        const signer = await provider.getSigner(account);
        if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) {
          throw new Error(WRONG_NETWORK_MESSAGE);
        }
        if (current !== revision.current) return;
        if (!isArbitrator(details, await signer.getAddress())) {
          throw new Error("Select the designated arbitrator wallet in MetaMask.");
        }
        if (current !== revision.current) return;
        // These UI checks help usability; Solidity remains the security authority.
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Waiting for MetaMask confirmation...");
        const tx = await contract.resolveDispute(id, decision);
        if (current === revision.current) {
          setHash(tx.hash);
          setStatus("Transaction submitted. Waiting for blockchain confirmation...");
        }
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setDecision(null);
        setStatus(`Transaction confirmed. Job ${id} dispute resolved successfully. ${decision === DECISIONS.REFUND ? "Escrow returned to the client. State: REFUNDED." : "Escrow released to the freelancer. State: RELEASED."}`);
      }
      // Keep transaction success separate from a failed details refresh.
      try {
        // Read the confirmed block to avoid a cached pre-resolution result.
        const details = await readJob(provider, id, confirmedBlock);
        if (current === revision.current) setJob(details);
      } catch (err) {
        if (current === revision.current) setError(`${resolve ? "Dispute resolved, but details could not be refreshed. Load Job again: " : ""}${errorMessage(err)}`);
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
    <section className="form-panel accept-job-panel" aria-labelledby="resolve-dispute-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR ARBITRATORS</p><h2 id="resolve-dispute-heading">Resolve Dispute</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">Load a disputed job and review the submitted work. Only its designated arbitrator can choose whether to refund the client or release payment to the freelancer.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="resolve-dispute-job-id">Job ID</label>
            <input id="resolve-dispute-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
              onChange={(event) => { revision.current++; setDecision(null); setJobId(event.target.value); setJob(null); setError(""); setStatus(""); setHash(""); }} />
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
          <div><dt>Escrow amount</dt><dd>{ethers.formatEther(job.amount)} ETH</dd></div>
          <div><dt>Deadline (local time)</dt><dd>{formatDeadline(job.deadline)}</dd></div>
          <div><dt>Current state</dt><dd>{STATES[Number(job.state)] ?? "UNKNOWN"}</dd></div>
          <div><dt>Submitted work proof</dt><dd>{job.workProof || "No work proof stored."}</dd></div>
        </dl>
      )}
      <fieldset className="resolution-options"
        disabled={!account || busy || !job || job.state !== 4n || !isArbitrator(job, account)}>
        <legend>Choose the dispute outcome</legend>
        <label>
          <input type="radio" name="dispute-decision" value={DECISIONS.REFUND}
            checked={decision === DECISIONS.REFUND} onChange={() => setDecision(DECISIONS.REFUND)} />
          <span><strong>REFUND CLIENT</strong><small>Escrow payment is returned to the client.</small></span>
        </label>
        <label>
          <input type="radio" name="dispute-decision" value={DECISIONS.RELEASE}
            checked={decision === DECISIONS.RELEASE} onChange={() => setDecision(DECISIONS.RELEASE)} />
          <span><strong>RELEASE TO FREELANCER</strong><small>Escrow payment is released to the assigned freelancer.</small></span>
        </label>
      </fieldset>
      <button className="create-button accept-job-button" type="button"
        disabled={!account || busy || !job || job.state !== 4n || !isArbitrator(job, account)
          || (decision !== DECISIONS.REFUND && decision !== DECISIONS.RELEASE)}
        onClick={() => void runAction(true)}>
        Resolve Dispute
      </button>
      {job && job.state !== 4n && <p className="form-note">A dispute can only be resolved when the job is DISPUTED.</p>}
      {job && account && !isArbitrator(job, account)
        && <p className="form-note">Select the designated arbitrator wallet in MetaMask to resolve this dispute.</p>}
      <p className="form-note">The contract sends escrow only to the recorded client or freelancer; no other recipient can be chosen. Resolution requires MetaMask approval and local ETH for gas.</p>
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
