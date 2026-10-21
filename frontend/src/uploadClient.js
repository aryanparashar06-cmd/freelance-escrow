import { ethers } from "ethers";
import { MAX_HASH_FILE_BYTES, parseIpfsReference } from "./workProof.js";

export const UPLOAD_SERVICE_URL = (import.meta.env?.VITE_UPLOAD_SERVICE_URL || "http://127.0.0.1:8787")
  .trim()
  .replace(/\/+$/, "");

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const SECURE_UPLOAD_STAGES = [
  { id: "selected", label: "File selected" },
  { id: "hashed", label: "SHA-256 calculated" },
  { id: "uploading", label: "Uploading to secure backend" },
  { id: "scanning", label: "Security scan in progress" },
  { id: "scan-passed", label: "No threats detected by scanner" },
  { id: "publishing", label: "Uploading scanned file to IPFS" },
  { id: "complete", label: "Upload successful, CID generated" },
];

export function validateDeliverableFile(file) {
  if (!file) throw new Error("Choose a deliverable file first.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("The selected file is empty or unreadable.");
  if (file.size > MAX_HASH_FILE_BYTES) throw new Error("The selected file exceeds the 50 MB upload limit.");
  const type = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(type)) {
    throw new Error(`Files of type ${type} are not allowed. Use PDF, ZIP, an image, text, or a common office document.`);
  }
  return { name: file.name, size: file.size, type };
}

async function readResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The upload service returned an unreadable response.");
  }
  if (!response.ok) throw new Error(payload?.error || `Upload service request failed (${response.status}).`);
  return payload;
}

async function postJson(path, body, { fetchImpl = fetch, signal } = {}) {
  let response;
  try {
    response = await fetchImpl(`${UPLOAD_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Upload authorization was cancelled.", { cause: error });
    throw new Error("Cannot reach the secure upload service. Check its URL and server status.", { cause: error });
  }
  return readResponse(response);
}

export async function requestUploadAuthorization({ provider, account, jobId, file, sha256, signal, fetchImpl }) {
  if (!UPLOAD_SERVICE_URL) throw new Error("The upload service URL is not configured.");
  const fileMetadata = { ...validateDeliverableFile(file), sha256 };
  const identity = { walletAddress: ethers.getAddress(account), jobId: jobId.toString(), file: fileMetadata };
  const challenge = await postJson("/v1/upload/challenge", identity, { fetchImpl, signal });
  if (typeof challenge.message !== "string" || typeof challenge.challengeId !== "string") {
    throw new Error("The upload service returned an invalid authorization challenge.");
  }

  let signature;
  try {
    const signer = await provider.getSigner(account);
    signature = await signer.signMessage(challenge.message);
  } catch (error) {
    if (error.code === 4001 || error.code === "ACTION_REJECTED" || error.info?.error?.code === 4001) {
      throw new Error("Upload authorization signature was cancelled in MetaMask.", { cause: error });
    }
    throw error;
  }
  return postJson("/v1/upload/authorize", {
    ...identity,
    challengeId: challenge.challengeId,
    signature,
  }, { fetchImpl, signal });
}

export function uploadFileSecurely({ uploadToken, file, signal, onProgress, onStage, xhrFactory = () => new XMLHttpRequest() }) {
  if (typeof uploadToken !== "string" || uploadToken.length < 32) {
    return Promise.reject(new Error("The upload service did not return a valid one-time upload authorization."));
  }
  return new Promise((resolve, reject) => {
    const request = xhrFactory();
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    request.open("POST", `${UPLOAD_SERVICE_URL}/v1/upload`);
    request.setRequestHeader("X-Upload-Token", uploadToken);
    onStage?.("uploading");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress?.(progress);
        if (progress === 100) onStage?.("scanning");
      }
    });
    request.addEventListener("load", () => {
      cleanup();
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The secure upload service returned an unreadable response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload?.error || `Secure upload failed (${request.status}).`));
        return;
      }
      const cid = payload?.cid;
      const parsed = typeof cid === "string" ? parseIpfsReference(cid) : null;
      if (!parsed?.isIpfs || parsed.error) {
        reject(new Error("The secure upload response did not contain a valid CID."));
        return;
      }
      if (payload.scanStatus !== "no-threats-detected") {
        reject(new Error("The secure upload service did not confirm a completed malware scan."));
        return;
      }
      onProgress?.(100);
      onStage?.("complete");
      resolve({ cid, uri: `ipfs://${cid}`, providerFileId: payload.providerFileId || "", scanStatus: payload.scanStatus });
    });
    request.addEventListener("error", () => {
      cleanup();
      reject(new Error("The secure file upload failed because of a network error."));
    });
    request.addEventListener("abort", () => {
      cleanup();
      reject(new Error("File upload was cancelled."));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}

export async function submitWorkProofTransaction({ contract, jobId, proof, onSubmitted }) {
  const transaction = await contract.submitWork(jobId, proof);
  onSubmitted?.(transaction.hash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed successfully.");
  return { transaction, receipt };
}
