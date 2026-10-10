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
  if (reason?.includes("Only freelancer can submit")) return "Only the assigned freelancer can submit work for this job. Select that wallet in MetaMask.";
  if (reason?.includes("Job is not accepted")) return "Work can only be submitted when the job is ACCEPTED.";
  if (reason?.includes("Job does not exist")) return "Job does not exist. Check the Job ID.";
  if (reason?.includes("Deadline has passed")) return "The job deadline has passed. Work can no longer be submitted.";
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

export default function SubmitWork({ account }) {
  const [jobId, setJobId] = useState("");
  const [workProof, setWorkProof] = useState("");
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
    if (!window.ethereum || !account) throw new Error("Connect MetaMask before loading or submitting work.");
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
    const result = await contract.jobs(id, { blockTag });
    if (result.state === 0n) throw new Error("Job does not exist");
    return { id: id.toString(), client: result.client, freelancer: result.freelancer,
      arbitrator: result.arbitrator, title: result.title, amount: result.amount,
      deadline: result.deadline, workProof: result.workProof, state: result.state };
  }

  async function runAction(submit) {
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
      if (submit) {
        const proof = workProof.trim();
        if (!proof) throw new Error("Enter a non-empty work proof.");
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if (details.state !== 2n) throw new Error("Work can only be submitted when the job is ACCEPTED.");
        if (details.freelancer.toLowerCase() !== account.toLowerCase()) {
          throw new Error("Only the assigned freelancer can submit work. Select that wallet in MetaMask.");
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
        // These UI checks help usability; Solidity remains the security authority.
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Waiting for MetaMask confirmation...");
        const tx = await contract.submitWork(id, proof);
        if (current === revision.current) {
          setHash(tx.hash);
          setStatus("Transaction submitted. Waiting for blockchain confirmation...");
        }
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setWorkProof("");
        setStatus(`Job ${id} work submitted successfully. State: SUBMITTED.`);
      }
      // Keep transaction success separate from a failed details refresh.
      try {
        // Read the confirmed block to avoid a cached pre-submission result.
        const details = await readJob(provider, id, confirmedBlock);
        if (current === revision.current) setJob(details);
      } catch (err) {
        if (current === revision.current) setError(`${submit ? "Work submitted, but details could not be refreshed. Load Job again: " : ""}${errorMessage(err)}`);
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
    <section className="form-panel accept-job-panel" aria-labelledby="submit-work-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR FREELANCERS</p><h2 id="submit-work-heading">Submit Work</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">Load an accepted job, then submit your work proof using the assigned freelancer wallet.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="submit-work-job-id">Job ID</label>
            <input id="submit-work-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
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
          {job.workProof && <div><dt>Stored work proof</dt><dd>{job.workProof}</dd></div>}
        </dl>
      )}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(true); }}>
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="submit-work-proof">Work proof</label>
            <input id="submit-work-proof" type="text" required placeholder="URL, IPFS reference, hash, GitHub link, or other proof"
              value={workProof} onChange={(event) => setWorkProof(event.target.value)} />
          </div>
          <button className="create-button" type="submit"
            disabled={!account || busy || !job || job.state !== 2n || job.freelancer.toLowerCase() !== account.toLowerCase()}>
            Submit Work
          </button>
        </fieldset>
      </form>
      {job && job.state !== 2n && <p className="form-note">Work can only be submitted when the job is ACCEPTED.</p>}
      {job && account && job.freelancer.toLowerCase() !== account.toLowerCase()
        && <p className="form-note">Select the assigned freelancer wallet in MetaMask to submit work.</p>}
      <p className="form-note">Load the job first. Any non-empty proof string is supported. Submission requires MetaMask approval and local ETH for gas.</p>
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
