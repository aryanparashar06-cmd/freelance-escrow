import { ethers } from "ethers";

const DEFAULT_MIME_TYPES = [
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
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
];

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseOrigins(value) {
  const origins = (value || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return url.origin !== origin || !["http:", "https:"].includes(url.protocol);
    } catch {
      return true;
    }
  })) {
    throw new Error("ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without paths.");
  }
  return new Set(origins);
}

export function loadConfig(environment = process.env) {
  const address = environment.ESCROW_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
    throw new Error("ESCROW_ADDRESS must be a valid non-zero Ethereum address.");
  }

  const mimeTypes = (environment.ALLOWED_MIME_TYPES || DEFAULT_MIME_TYPES.join(","))
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!mimeTypes.length) throw new Error("At least one ALLOWED_MIME_TYPES value is required.");

  return {
    port: positiveInteger(environment.PORT, 8787, "PORT"),
    host: environment.HOST || "127.0.0.1",
    trustProxy: String(environment.TRUST_PROXY || "false").toLowerCase() === "true",
    pinataJwt: environment.PINATA_JWT || "",
    rpcUrl: environment.RPC_URL || "http://127.0.0.1:8545",
    chainId: BigInt(environment.CHAIN_ID || "31337"),
    escrowAddress: ethers.getAddress(address),
    allowedOrigins: parseOrigins(environment.ALLOWED_ORIGINS),
    allowedMimeTypes: new Set(mimeTypes),
    maxFileBytes: positiveInteger(environment.MAX_FILE_BYTES, 50 * 1024 * 1024, "MAX_FILE_BYTES"),
    signedUploadTtlSeconds: positiveInteger(environment.SIGNED_UPLOAD_TTL_SECONDS, 60, "SIGNED_UPLOAD_TTL_SECONDS"),
    pinataRequestTimeoutMs: positiveInteger(environment.PINATA_REQUEST_TIMEOUT_MS, 10_000, "PINATA_REQUEST_TIMEOUT_MS"),
    challengeTtlSeconds: positiveInteger(environment.CHALLENGE_TTL_SECONDS, 300, "CHALLENGE_TTL_SECONDS"),
    rateLimitWindowMs: positiveInteger(environment.RATE_LIMIT_WINDOW_SECONDS, 60, "RATE_LIMIT_WINDOW_SECONDS") * 1000,
    rateLimitPerIp: positiveInteger(environment.RATE_LIMIT_PER_IP, 20, "RATE_LIMIT_PER_IP"),
    rateLimitPerWallet: positiveInteger(environment.RATE_LIMIT_PER_WALLET, 10, "RATE_LIMIT_PER_WALLET"),
  };
}
