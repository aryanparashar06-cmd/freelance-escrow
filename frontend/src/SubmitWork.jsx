import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, WRONG_NETWORK_MESSAGE, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import GasEstimate from "./gasEstimate";
import { estimateGasCost } from "./gasCosts";
import {
  MAX_HASH_FILE_BYTES,
  analyzeWorkProof,
  calculateFileSha256,
  formatFileSize,
  validateWorkProof,
} from "./workProof";
import {
  requestUploadAuthorization,
  SECURE_UPLOAD_STAGES,
  submitWorkProofTransaction,
  uploadFileSecurely,
  validateDeliverableFile,
} from "./uploadClient";
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
  if (/file signature|active or executable|valid UTF-8|valid JSON|unsupported binary/i.test(reason || "")) {
    return `Upload rejected: unsafe or unsupported file. ${reason}`;
  }
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
  const [gasEstimate, setGasEstimate] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [fileType, setFileType] = useState("");
  const [fileDigest, setFileDigest] = useState("");
  const [fileHashError, setFileHashError] = useState("");
  const [hashingFile, setHashingFile] = useState(false);
  const [copied, setCopied] = useState("");
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [publicUploadConfirmed, setPublicUploadConfirmed] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadStage, setUploadStage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const revision = useRef(0);
  const fileRevision = useRef(0);
  const pending = useRef(false);
  const uploadController = useRef(null);

  useEffect(() => {
    const wallet = window.ethereum;
    const requests = revision;
    function clearDetails() {
      requests.current++;
      uploadController.current?.abort();
      setJob(null);
      setError("");
      setStatus("");
      setHash("");
      setGasEstimate(null);
      setUploadedFile(null);
      setUploadStatus("");
      setUploadError("");
      setUploadProgress(0);
      setUploadStage("");
    }
    wallet?.on("accountsChanged", clearDetails);
    wallet?.on("chainChanged", clearDetails);
    return () => {
      requests.current++;
      uploadController.current?.abort();
      wallet?.removeListener("accountsChanged", clearDetails);
      wallet?.removeListener("chainChanged", clearDetails);
    };
  }, []);

  async function handleFileSelection(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const current = ++fileRevision.current;
    setSelectedFile(null);
    setFileName(file.name);
    setFileSize(file.size);
    setFileType(file.type || "application/octet-stream");
    setFileDigest("");
    setFileHashError("");
    setCopied("");
    setUploadedFile(null);
    setUploadStatus("");
    setUploadError("");
    setUploadProgress(0);
    setUploadStage("selected");
    setPublicUploadConfirmed(false);
    setHashingFile(true);
    try {
      validateDeliverableFile(file);
      const digest = await calculateFileSha256(file);
      if (current !== fileRevision.current) return;
      setSelectedFile(file);
      setFileDigest(digest);
      setUploadStage("hashed");
    } catch (err) {
      if (current === fileRevision.current) setFileHashError(err.message || "The selected file could not be prepared.");
    } finally {
      if (current === fileRevision.current) setHashingFile(false);
    }
  }

  async function copyText(value, label) {
    setFileHashError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch (err) {
      setCopied("");
      setFileHashError(err.message || "Unable to copy. Select and copy the value manually.");
    }
  }

  function insertDigest() {
    if (!fileDigest) return;
    const reference = `sha256:${fileDigest}`;
    setWorkProof((current) => current.trim() ? `${current.trim()}\n${reference}` : reference);
    setGasEstimate(null);
  }

  function insertUploadedProof() {
    if (!uploadedFile) return;
    const reference = `${uploadedFile.uri}\nsha256:${fileDigest}`;
    setWorkProof(reference);
    setGasEstimate(null);
  }

  async function getProvider() {
    if (!window.ethereum || !account) throw new Error("Connect MetaMask before loading, uploading, or submitting work.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== LOCAL_CHAIN_ID) throw new Error(WRONG_NETWORK_MESSAGE);
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

  async function handleUpload() {
    if (uploadBusy) return;
    setUploadBusy(true);
    setUploadError("");
    setUploadStatus("");
    setUploadProgress(0);
    setUploadStage("hashed");
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      if (!publicUploadConfirmed) throw new Error("Acknowledge the public IPFS warning before uploading.");
      validateDeliverableFile(selectedFile);
      if (!fileDigest) throw new Error("Wait for the SHA-256 checksum before uploading.");
      const id = parseJobId(jobId);
      const provider = await getProvider();
      const details = await readJob(provider, id);
      setJob(details);
      if (details.state !== 2n) throw new Error("The job must be ACCEPTED before a deliverable can be uploaded.");
      if (details.freelancer.toLowerCase() !== account.toLowerCase()) {
        throw new Error("Only the assigned freelancer can upload a deliverable for this job.");
      }
      setUploadStatus("Requesting a one-time upload challenge. MetaMask will ask you to sign a message...");
      const authorization = await requestUploadAuthorization({
        provider,
        account,
        jobId: id,
        file: selectedFile,
        sha256: fileDigest,
        signal: controller.signal,
      });
      setUploadStatus("Uploading to the secure backend. The file stays private until validation and scanning pass.");
      const result = await uploadFileSecurely({
        uploadToken: authorization.uploadToken,
        file: selectedFile,
        signal: controller.signal,
        onProgress: setUploadProgress,
        onStage: (stage) => {
          setUploadStage(stage);
          if (stage === "scanning") {
            setUploadStatus("Security scan and server-side publication are in progress. Upload remains blocked unless scanning succeeds.");
          }
        },
      });
      setUploadedFile(result);
      setUploadStatus("No threats detected by scanner. File uploaded to IPFS; review the CID before submitting proof on-chain.");
    } catch (err) {
      setUploadStatus("");
      setUploadError(errorMessage(err));
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      setUploadBusy(false);
    }
  }

  async function runAction(submit) {
    if (pending.current) return;
    pending.current = true;
    const current = ++revision.current;
    setBusy(true);
    setError("");
    setStatus("");
    setHash("");
    setGasEstimate(null);
    setJob(null);
    try {
      const id = parseJobId(jobId);
      const provider = await getProvider();
      if (current !== revision.current) return;
      let confirmedBlock = "latest";
      if (submit) {
        const proof = workProof.trim();
        validateWorkProof(proof);
        if (!privacyConfirmed) {
          throw new Error("Confirm that you understand the work proof will be stored on a public, persistent blockchain record.");
        }
        const details = await readJob(provider, id);
        if (current !== revision.current) return;
        setJob(details);
        if (details.state !== 2n) throw new Error("Work can only be submitted when the job is ACCEPTED.");
        if (details.freelancer.toLowerCase() !== account.toLowerCase()) {
          throw new Error("Only the assigned freelancer can submit work. Select that wallet in MetaMask.");
        }
        const signer = await provider.getSigner(account);
        if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) throw new Error(WRONG_NETWORK_MESSAGE);
        if (current !== revision.current) return;
        if ((await signer.getAddress()).toLowerCase() !== details.freelancer.toLowerCase()) {
          throw new Error("Select the assigned freelancer wallet in MetaMask.");
        }
        if (current !== revision.current) return;
        const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        setStatus("Estimating gas with the connected network...");
        const estimate = await estimateGasCost(provider, () => contract.submitWork.estimateGas(id, proof));
        if (current !== revision.current) return;
        setGasEstimate(estimate);
        setStatus("Waiting for MetaMask confirmation...");
        const { receipt } = await submitWorkProofTransaction({
          contract,
          jobId: id,
          proof,
          onSubmitted: (transactionHash) => {
            if (current !== revision.current) return;
            setHash(transactionHash);
            setStatus("Transaction submitted. Waiting for blockchain confirmation...");
          },
        });
        if (current !== revision.current) return;
        confirmedBlock = receipt.blockNumber;
        setWorkProof("");
        setPrivacyConfirmed(false);
        setStatus(`Transaction confirmed. Job ${id} work submitted successfully. State: SUBMITTED.`);
      }
      try {
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

  const proofAnalysis = analyzeWorkProof(workProof);
  const eligibleWallet = Boolean(job && account && job.state === 2n
    && job.freelancer.toLowerCase() === account.toLowerCase());

  return (
    <section className="form-panel accept-job-panel" aria-labelledby="submit-work-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">FOR FREELANCERS</p><h2 id="submit-work-heading">Submit Work</h2></div>
        <span className="panel-symbol" aria-hidden="true">◇</span>
      </div>
      <p className="panel-intro">Load an accepted job, upload an optional deliverable, then submit the reviewed proof using the assigned freelancer wallet.</p>
      {!account && <p className="form-note">Connect MetaMask using the wallet button above.</p>}
      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(false); }}>
        <fieldset disabled={busy || uploadBusy}>
          <div className="field">
            <label htmlFor="submit-work-job-id">Job ID</label>
            <input id="submit-work-job-id" inputMode="numeric" placeholder="e.g. 1" required value={jobId}
              onChange={(event) => {
                revision.current++;
                uploadController.current?.abort();
                setJobId(event.target.value);
                setJob(null);
                setError("");
                setStatus("");
                setHash("");
                setUploadedFile(null);
                setUploadStatus("");
                setUploadError("");
                setUploadStage("");
              }} />
          </div>
          <button className="create-button" type="submit" disabled={!account || busy || uploadBusy}>Load Job</button>
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

      <div className="file-hash-tool upload-deliverable">
        <div className="file-hash-heading">
          <div>
            <span className="proof-kicker">STEP 1 · OPTIONAL OFF-CHAIN FILE</span>
            <strong>Scan and upload deliverable to public IPFS</strong>
          </div>
          <label className={hashingFile || uploadBusy ? "file-picker disabled" : "file-picker"}>
            {hashingFile ? "Hashing file..." : "Choose file"}
            <input type="file" onChange={handleFileSelection} disabled={hashingFile || uploadBusy || busy} />
          </label>
        </div>
        <p>Choosing a file calculates its SHA-256 checksum locally. Upload sends the bytes to a private backend quarantine, recomputes the checksum, validates the file signature, scans it, and publishes only a passing file. The limit is {formatFileSize(MAX_HASH_FILE_BYTES)}.</p>
        {fileName && (
          <div className="file-hash-result" aria-live="polite">
            <span>Selected file</span>
            <strong>{fileName} · {formatFileSize(fileSize)} · {fileType}</strong>
            {hashingFile && <em>Reading and calculating SHA-256...</em>}
            {fileDigest && (
              <>
                <span>SHA-256 digest</span>
                <code>{fileDigest}</code>
                <div className="proof-tool-actions">
                  <button type="button" onClick={() => void copyText(`sha256:${fileDigest}`, "hash")}>{copied === "hash" ? "Copied" : "Copy hash reference"}</button>
                  <button type="button" onClick={insertDigest}>Insert hash only</button>
                </div>
              </>
            )}
          </div>
        )}
        {fileHashError && <p className="inline-error" role="alert">{fileHashError}</p>}

        {uploadStage && (
          <ol className="secure-upload-stages" aria-label="Secure upload stages">
            {SECURE_UPLOAD_STAGES.map((stage, index) => {
              const currentIndex = SECURE_UPLOAD_STAGES.findIndex((item) => item.id === uploadStage);
              const stageState = index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending";
              return <li className={stageState} key={stage.id}><span aria-hidden="true">{stageState === "complete" ? "✓" : "◇"}</span>{stage.label}</li>;
            })}
          </ol>
        )}

        <div className="privacy-warning upload-privacy-warning">
          <strong>Public IPFS privacy warning</strong>
          <p>Files uploaded to public IPFS may be accessible to anyone who obtains their CID. Do not upload passwords, private keys, confidential client information, personal documents or other sensitive deliverables.</p>
          <p>This prototype does not encrypt files or provide private key sharing. Confidential deliverables need a separately designed encryption and key-sharing system.</p>
          <label className="privacy-confirmation">
            <input type="checkbox" checked={publicUploadConfirmed}
              onChange={(event) => setPublicUploadConfirmed(event.target.checked)} />
            I understand this file will be uploaded to public IPFS and may be publicly accessible.
          </label>
        </div>
        <div className="upload-actions">
          <button className="create-button" type="button" onClick={() => void handleUpload()}
            disabled={!eligibleWallet || !selectedFile || !fileDigest || hashingFile || busy || uploadBusy || !publicUploadConfirmed || Boolean(uploadedFile)}>
            {uploadBusy ? "Scanning & Uploading..." : uploadedFile ? "Scanned & Uploaded" : "Scan & Upload to IPFS"} <span aria-hidden="true">↗</span>
          </button>
          {uploadBusy && (
            <button className="secondary-action" type="button" onClick={() => uploadController.current?.abort()}>
              Cancel upload
            </button>
          )}
        </div>
        {(uploadBusy || uploadProgress > 0) && (
          <div className="upload-progress" aria-label={`Upload progress ${uploadProgress}%`}>
            <span style={{ width: `${uploadProgress}%` }} /><b>{uploadProgress}%</b>
          </div>
        )}
        {uploadStatus && <p className="transaction" role="status">{uploadStatus}</p>}
        {uploadError && <p className="inline-error" role="alert">{uploadError}</p>}
        {uploadedFile && (
          <div className="upload-result">
            <span>IPFS CID</span>
            <code>{uploadedFile.cid}</code>
            <span>IPFS URI</span>
            <code>{uploadedFile.uri}</code>
            <span>Security scan</span>
            <strong>No threats detected by scanner</strong>
            <div className="proof-tool-actions">
              <button type="button" onClick={() => void copyText(uploadedFile.cid, "cid")}>{copied === "cid" ? "CID copied" : "Copy CID"}</button>
              <button type="button" onClick={() => void copyText(uploadedFile.uri, "uri")}>{copied === "uri" ? "URI copied" : "Copy URI"}</button>
              <button type="button" onClick={insertUploadedProof}>Insert URI + checksum into proof</button>
            </div>
            <em>Upload succeeded off-chain. Scanner detection is not a guarantee of safety. No blockchain transaction has been sent yet, and pinning does not guarantee permanent availability.</em>
          </div>
        )}
      </div>

      <form className="create-job" onSubmit={(event) => { event.preventDefault(); void runAction(true); }}>
        <fieldset disabled={busy || uploadBusy}>
          <div className="field">
            <label htmlFor="submit-work-proof">Step 2 · On-chain work proof</label>
            <textarea id="submit-work-proof" required rows="5"
              placeholder="Manual text, hash, GitHub link, CID, or the uploaded ipfs:// URI"
              value={workProof} onChange={(event) => { setWorkProof(event.target.value); setGasEstimate(null); }} />
            {workProof && proofAnalysis.type !== "invalid" && <span className="proof-type">Detected: {proofAnalysis.label}</span>}
            {proofAnalysis.type === "invalid" && <span className="proof-validation" role="alert">{proofAnalysis.error}</span>}
          </div>
          <div className="privacy-warning">
            <strong>Public blockchain warning</strong>
            <p>The proof string submitted to Ethereum may be publicly visible and difficult to remove. Review the CID and checksum before continuing.</p>
            <ul>
              <li><b>SHA-256:</b> an integrity fingerprint, not encryption or proof of quality.</li>
              <li><b>IPFS CID:</b> a content reference, not guaranteed storage, availability, or confidentiality.</li>
              <li><b>Blockchain transaction:</b> a distinct step requiring MetaMask approval and gas.</li>
            </ul>
            <label className="privacy-confirmation">
              <input type="checkbox" checked={privacyConfirmed}
                onChange={(event) => setPrivacyConfirmed(event.target.checked)} />
              I reviewed the proof and understand that this string will be stored on-chain.
            </label>
          </div>
          <button className="create-button" type="submit"
            disabled={!account || busy || uploadBusy || hashingFile || !privacyConfirmed || proofAnalysis.type === "invalid" || !eligibleWallet}>
            Submit Work On-Chain
          </button>
        </fieldset>
      </form>
      {job && job.state !== 2n && <p className="form-note">Work can only be uploaded or submitted when the job is ACCEPTED.</p>}
      {job && account && job.freelancer.toLowerCase() !== account.toLowerCase()
        && <p className="form-note">Select the assigned freelancer wallet in MetaMask to upload or submit work.</p>}
      <p className="form-note">Manual proof remains supported. An upload never submits a transaction automatically; Step 2 still requires separate MetaMask approval.</p>
      <GasEstimate estimate={gasEstimate} valueNote="Submitting work sends no escrow value; only the network fee is charged." />
      {busy && !status && <p className="transaction" role="status">Loading...</p>}
      {status && <p className="transaction" role="status">{status}</p>}
      {hash && <p className="transaction transaction-hash">Transaction hash: {hash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
