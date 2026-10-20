import { randomBytes, randomUUID } from "node:crypto";
import { ethers } from "ethers";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const JOB_ID = /^[1-9][0-9]*$/;
const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+\-/]{0,126}$/;

export class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateUploadMetadata(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PublicError(400, "Upload metadata is required.");
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const type = typeof input.type === "string" ? input.type.trim().toLowerCase() : "";
  const sha256 = typeof input.sha256 === "string" ? input.sha256.trim().toLowerCase() : "";
  const size = Number(input.size);

  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new PublicError(400, "File name is missing or contains unsafe characters.");
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > config.maxFileBytes) {
    throw new PublicError(400, `File size must be between 1 and ${config.maxFileBytes} bytes.`);
  }
  if (!SAFE_MIME.test(type) || !config.allowedMimeTypes.has(type)) {
    throw new PublicError(400, "This file type is not allowed by the upload service.");
  }
  if (!SHA256_HEX.test(sha256)) {
    throw new PublicError(400, "A valid lowercase SHA-256 checksum is required.");
  }
  return { name, type, size, sha256 };
}

export function validateUploadIdentity(input, config) {
  const jobId = typeof input?.jobId === "string" ? input.jobId.trim() : String(input?.jobId ?? "");
  if (!JOB_ID.test(jobId)) throw new PublicError(400, "Job ID must be a positive whole number.");
  let walletAddress;
  try {
    walletAddress = ethers.getAddress(input?.walletAddress || "");
  } catch {
    throw new PublicError(400, "A valid wallet address is required.");
  }
  const numericJobId = BigInt(jobId);
  if (numericJobId > ethers.MaxUint256) throw new PublicError(400, "Job ID exceeds uint256.");
  return {
    walletAddress,
    jobId,
    file: validateUploadMetadata(input.file, config),
  };
}

export class ChallengeStore {
  constructor({ ttlSeconds, now = () => Date.now() }) {
    this.ttlMs = ttlSeconds * 1000;
    this.now = now;
    this.items = new Map();
  }

  create(identity, context) {
    this.cleanup();
    const issuedAt = this.now();
    const challengeId = randomUUID();
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = issuedAt + this.ttlMs;
    const message = [
      "Freelance Escrow upload authorization",
      "",
      `Origin: ${context.origin || "non-browser-client"}`,
      `Wallet: ${identity.walletAddress}`,
      `Contract: ${context.escrowAddress}`,
      `Chain ID: ${context.chainId}`,
      `Job ID: ${identity.jobId}`,
      `File name: ${identity.file.name}`,
      `MIME type: ${identity.file.type}`,
      `File size: ${identity.file.size}`,
      `SHA-256: ${identity.file.sha256}`,
      `Nonce: ${nonce}`,
      `Issued at: ${new Date(issuedAt).toISOString()}`,
      `Expires at: ${new Date(expiresAt).toISOString()}`,
      "",
      "Signing does not create a blockchain transaction or authorize payment.",
    ].join("\n");
    this.items.set(challengeId, { identity, message, expiresAt, origin: context.origin || "" });
    return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(challengeId) {
    const item = this.items.get(challengeId);
    this.items.delete(challengeId);
    if (!item) throw new PublicError(401, "Upload challenge is missing, expired, or already used.");
    if (item.expiresAt <= this.now()) throw new PublicError(401, "Upload challenge has expired. Request a new one.");
    return item;
  }

  cleanup() {
    const now = this.now();
    for (const [key, item] of this.items) {
      if (item.expiresAt <= now) this.items.delete(key);
    }
  }
}

export function sameUploadIdentity(first, second) {
  return first.walletAddress === second.walletAddress
    && first.jobId === second.jobId
    && first.file.name === second.file.name
    && first.file.type === second.file.type
    && first.file.size === second.file.size
    && first.file.sha256 === second.file.sha256;
}

export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const buckets = new Map();
  let checks = 0;
  return {
    check(key) {
      const time = now();
      checks += 1;
      if (checks % 100 === 0) {
        for (const [bucketKey, entries] of buckets) {
          const active = entries.filter((entry) => time - entry < windowMs);
          if (active.length) buckets.set(bucketKey, active);
          else buckets.delete(bucketKey);
        }
      }
      const recent = (buckets.get(key) || []).filter((entry) => time - entry < windowMs);
      if (recent.length >= limit) throw new PublicError(429, "Too many upload authorization requests. Try again later.");
      recent.push(time);
      buckets.set(key, recent);
    },
  };
}
