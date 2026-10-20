import { useState } from "react";
import { ethers } from "ethers";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  LOCAL_CHAIN_ID,
  WRONG_NETWORK_MESSAGE,
} from "./escrow";
import { analyzeWorkProof, calculateFileSha256, formatFileSize } from "./workProof";
import "./JobDashboard.css";

const JOB_STATES = ["NONE", "FUNDED", "ACCEPTED", "SUBMITTED", "DISPUTED", "RELEASED", "REFUNDED"];
const REVIEW_PERIOD_FALLBACK = 3n * 24n * 60n * 60n;

function formatAddress(address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp || timestamp === 0n) return "Not recorded";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatDuration(seconds) {
  const days = Number(seconds) / 86400;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function sameAddress(first, second) {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}

function JobDashboard({ account }) {
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [chainTime, setChainTime] = useState(null);
  const [reviewPeriod, setReviewPeriod] = useState(REVIEW_PERIOD_FALLBACK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState(null);

  async function loadJob(event) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    setJob(null);
    setVerification(null);

    try {
      if (!window.ethereum) throw new Error("MetaMask is required to load a job.");
      if (!jobId.trim() || !/^\d+$/.test(jobId.trim()) || BigInt(jobId.trim()) === 0n) {
        throw new Error("Enter a valid Job ID greater than zero.");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== LOCAL_CHAIN_ID) throw new Error(WRONG_NETWORK_MESSAGE);
      if (await provider.getCode(ESCROW_ADDRESS) === "0x") {
        throw new Error("No escrow contract was found at the configured address.");
      }

      const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
      const requestedId = BigInt(jobId.trim());
      const totalJobs = await contract.jobCount();
      if (requestedId > totalJobs) throw new Error(`Job ${requestedId} does not exist.`);

      const [loadedJob, latestBlock, configuredReviewPeriod] = await Promise.all([
        contract.jobs(requestedId),
        provider.getBlock("latest"),
        contract.REVIEW_PERIOD().catch(() => REVIEW_PERIOD_FALLBACK),
      ]);
      if (!latestBlock || Number(loadedJob.state) === 0) {
        throw new Error(`Job ${requestedId} does not exist.`);
      }

      setJob({
        id: requestedId.toString(),
        client: loadedJob.client,
        freelancer: loadedJob.freelancer,
        arbitrator: loadedJob.arbitrator,
        amount: loadedJob.amount,
        title: loadedJob.title,
        deadline: loadedJob.deadline,
        createdAt: loadedJob.createdAt,
        submittedAt: loadedJob.submittedAt,
        workProof: loadedJob.workProof,
        state: Number(loadedJob.state),
      });
      setChainTime(BigInt(latestBlock.timestamp));
      setReviewPeriod(BigInt(configuredReviewPeriod));
    } catch (err) {
      setError(err.shortMessage || err.reason || err.message || "Unable to load this job.");
    } finally {
      setLoading(false);
    }
  }

  const stateName = job ? JOB_STATES[job.state] || `UNKNOWN (${job.state})` : "NOT LOADED";
  const role = !account
    ? "Wallet not connected"
    : !job
      ? "Load a job to detect your role"
      : sameAddress(account, job.client)
      ? "Client"
      : sameAddress(account, job.freelancer)
        ? "Freelancer"
        : sameAddress(account, job.arbitrator)
          ? "Arbitrator"
          : "Not a participant";
  const escrowStatus = job?.state === 5
    ? "Released to freelancer"
    : job?.state === 6
      ? "Refunded to client"
      : job?.state >= 1 && job?.state <= 4
        ? "Locked in escrow"
        : "No active escrow";
  const eligibleClaimTime = job?.submittedAt > 0n ? job.submittedAt + reviewPeriod : 0n;
  const timeoutEligible = Boolean(
    job && job.state === 3 && chainTime && chainTime > eligibleClaimTime,
  );
  const proofAnalysis = analyzeWorkProof(job?.workProof || "");

  async function verifyDownloadedFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !proofAnalysis.checksum) return;
    setVerification({ status: "checking", message: "Calculating SHA-256 locally..." });
    try {
      const digest = await calculateFileSha256(file);
      const matches = digest.toLowerCase() === proofAnalysis.checksum.toLowerCase();
      setVerification({
        status: matches ? "match" : "mismatch",
        message: matches
          ? `${file.name} (${formatFileSize(file.size)}) matches the recorded SHA-256 checksum.`
          : `${file.name} does not match the recorded SHA-256 checksum.`,
      });
    } catch (verificationError) {
      setVerification({ status: "error", message: verificationError.message || "Unable to verify this file." });
    }
  }

  const renderStage = (name) => (
    <span className={stateName === name ? "lifecycle-stage current" : "lifecycle-stage"}>
      {name}
    </span>
  );

  return (
    <section className="job-dashboard" id="job-dashboard" aria-labelledby="dashboard-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ON-CHAIN CONTROL CENTER</p>
          <h2 id="dashboard-title">Job dashboard</h2>
          <p>Load one job to inspect its participants, funds, timing, proof, and lifecycle.</p>
        </div>
        <span className={`state-badge state-${stateName.toLowerCase()}`}>{stateName}</span>
      </div>

      <form className="dashboard-loader" onSubmit={loadJob}>
        <div className="field">
          <label htmlFor="dashboardJobId">Job ID</label>
          <input
            id="dashboardJobId"
            type="text"
            inputMode="numeric"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder="e.g. 1"
          />
        </div>
        <button className="create-button" type="submit" disabled={loading}>
          {loading ? "Loading job..." : job ? "Refresh job" : "Load job"} <span aria-hidden="true">↗</span>
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}

      {job && (
        <>
          <div className="dashboard-summary">
            <article className="dashboard-metric">
              <span>CONNECTED ROLE</span>
              <strong>{role}</strong>
            </article>
            <article className="dashboard-metric">
              <span>ESCROW STATUS</span>
              <strong>{escrowStatus}</strong>
            </article>
            <article className="dashboard-metric">
              <span>ESCROW VALUE</span>
              <strong>{ethers.formatEther(job.amount)} ETH</strong>
            </article>
          </div>

          <div className="job-details-grid">
            <div><span>Job ID</span><strong>#{job.id}</strong></div>
            <div><span>Title</span><strong>{job.title}</strong></div>
            <div><span>Client</span><strong title={job.client}>{formatAddress(job.client)}</strong></div>
            <div><span>Freelancer</span><strong title={job.freelancer}>{formatAddress(job.freelancer)}</strong></div>
            <div><span>Arbitrator</span><strong title={job.arbitrator}>{formatAddress(job.arbitrator)}</strong></div>
            <div><span>Deadline</span><strong>{formatTimestamp(job.deadline)}</strong></div>
            <div><span>Created</span><strong>{formatTimestamp(job.createdAt)}</strong></div>
            <div><span>Submitted</span><strong>{formatTimestamp(job.submittedAt)}</strong></div>
            <div className="proof-detail">
              <span>Work proof</span>
              <strong className="proof-value">{job.workProof || "No proof submitted"}</strong>
              {job.workProof && <small>{proofAnalysis.label || "Stored proof reference"}</small>}
              {proofAnalysis.type === "ipfs" && (
                <a href={proofAnalysis.gatewayUrl} target="_blank" rel="noopener noreferrer">
                  Open Deliverable through configured IPFS gateway ↗
                </a>
              )}
              {proofAnalysis.type === "ipfs" && (
                <em>The external gateway is contacted only when you click. A CID identifies content but does not prove quality, correctness, availability, or confidentiality.</em>
              )}
              {proofAnalysis.type === "ipfs" && proofAnalysis.checksum && (
                <div className="proof-verification">
                  <label className="file-picker">
                    Verify a local downloaded file
                    <input type="file" onChange={verifyDownloadedFile} />
                  </label>
                  <small>Comparison happens locally against the SHA-256 checksum stored in the proof.</small>
                  {verification && <strong className={`verification-${verification.status}`} role="status">{verification.message}</strong>}
                </div>
              )}
            </div>
          </div>

          <div className="lifecycle" aria-label={`Current job state: ${stateName}`}>
            <p className="lifecycle-label">PRIMARY RELEASE PATH</p>
            <div className="lifecycle-row">
              {renderStage("FUNDED")}<i>→</i>{renderStage("ACCEPTED")}<i>→</i>
              {renderStage("SUBMITTED")}<i>→</i>{renderStage("RELEASED")}
            </div>
            <div className="alternate-paths">
              <div><span>Dispute path</span>{renderStage("DISPUTED")}<i>→</i>{renderStage("RELEASED")} / {renderStage("REFUNDED")}</div>
              <div><span>Deadline path</span>FUNDED / ACCEPTED <i>→</i> <b className="lifecycle-stage">DEADLINE REFUND</b> <i>→</i> {renderStage("REFUNDED")}</div>
              <div><span>Review timeout</span>SUBMITTED <i>→</i> <b className="lifecycle-stage">REVIEW TIMEOUT</b> <i>→</i> {renderStage("RELEASED")}</div>
            </div>
          </div>

          <div className="time-strip">
            <div><span>Latest blockchain time</span><strong>{formatTimestamp(chainTime)}</strong></div>
            <div><span>Review period</span><strong>{formatDuration(reviewPeriod)}</strong></div>
            <div>
              <span>Freelancer claim time</span>
              <strong>{eligibleClaimTime ? formatTimestamp(eligibleClaimTime) : "Starts after submission"}</strong>
              {job.state === 3 && <em>{timeoutEligible ? "Claim is now eligible" : "Review period is active"}</em>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default JobDashboard;
