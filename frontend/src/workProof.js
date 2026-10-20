export const MAX_HASH_FILE_BYTES = 50 * 1024 * 1024;

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_BASE32 = /^b[a-z2-7]{20,}$/;
const SHA256_REFERENCE = /^sha-?256:([a-fA-F0-9]{64})$/;
const RAW_SHA256 = /^[a-fA-F0-9]{64}$/;
const DEFAULT_GATEWAY = "https://ipfs.io/ipfs/";

export const IPFS_GATEWAY_BASE_URL = import.meta.env?.VITE_IPFS_GATEWAY_URL?.trim() || DEFAULT_GATEWAY;

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export async function calculateFileSha256(file) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support the Web Crypto API required for SHA-256 hashing.");
  }
  if (!file?.arrayBuffer) {
    throw new Error("This browser cannot read the selected file.");
  }
  if (file.size > MAX_HASH_FILE_BYTES) {
    throw new Error(`The selected file exceeds the ${formatFileSize(MAX_HASH_FILE_BYTES)} browser hashing limit.`);
  }

  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidCid(value) {
  return CID_V0.test(value) || CID_V1_BASE32.test(value);
}

function normalizedGatewayBase(gatewayBase) {
  let url;
  try {
    url = new URL(gatewayBase);
  } catch {
    throw new Error("The configured IPFS gateway URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("The configured IPFS gateway must use HTTPS.");
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/ipfs") ? `${path}/` : `${path}/ipfs/`;
  return url.toString();
}

export function createIpfsGatewayUrl(cid, pathParts = [], gatewayBase = IPFS_GATEWAY_BASE_URL) {
  if (!isValidCid(cid)) throw new Error("Cannot create a gateway link for an invalid CID.");
  const safePath = pathParts.map((part) => {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new Error("The IPFS path contains invalid encoding.");
    }
    if (decoded === "." || decoded === "..") throw new Error("The IPFS path cannot contain dot traversal segments.");
    return encodeURIComponent(decoded);
  }).join("/");
  return `${normalizedGatewayBase(gatewayBase)}${cid}${safePath ? `/${safePath}` : ""}`;
}

export function extractSha256(value) {
  const proof = value.trim();
  if (RAW_SHA256.test(proof)) return proof.toLowerCase();
  const match = proof.match(/(?:^|[\s|,;])sha-?256:([a-fA-F0-9]{64})(?=$|[\s|,;])/i);
  return match?.[1].toLowerCase() || "";
}

export function parseIpfsReference(value, gatewayBase = IPFS_GATEWAY_BASE_URL) {
  const proof = value.trim();
  const uriMatch = proof.match(/ipfs:\/\/([^\s|,;]+)/i);
  const hasIpfsScheme = /ipfs:/i.test(proof);
  let candidate = uriMatch?.[1] || "";

  if (!candidate && (CID_V0.test(proof.split("/")[0]) || CID_V1_BASE32.test(proof.split("/")[0]))) {
    candidate = proof;
  }
  if (!candidate) {
    if (hasIpfsScheme && !/ipfs:\/\//i.test(proof)) {
      return { isIpfs: true, error: "Use the IPFS URI format ipfs://<CID> or enter a CID directly." };
    }
    if (hasIpfsScheme || /^Qm/i.test(proof) || /^bafy/i.test(proof)) {
      return { isIpfs: true, error: "This looks like an IPFS reference, but its CID format is malformed." };
    }
    return { isIpfs: false };
  }

  const [cid, ...pathParts] = candidate.split("/");
  if (!isValidCid(cid)) {
    return { isIpfs: true, error: "This looks like an IPFS reference, but its CID format is malformed." };
  }
  try {
    return {
      isIpfs: true,
      cid,
      uri: `ipfs://${candidate}`,
      gatewayUrl: createIpfsGatewayUrl(cid, pathParts, gatewayBase),
    };
  } catch (error) {
    return { isIpfs: true, error: error.message };
  }
}

export function analyzeWorkProof(value) {
  const proof = value.trim();
  if (!proof) return { type: "empty", label: "No proof entered" };

  const checksum = extractSha256(proof);
  if (/sha-?256:/i.test(proof) && !checksum) {
    return { type: "invalid", error: "A SHA-256 reference must contain exactly 64 hexadecimal characters after sha256:." };
  }
  if (RAW_SHA256.test(proof)) {
    return { type: "sha256", label: "SHA-256 integrity fingerprint", checksum };
  }
  const ipfs = parseIpfsReference(proof);
  if (ipfs.error) return { type: "invalid", error: ipfs.error };
  if (ipfs.isIpfs) {
    return {
      type: "ipfs",
      label: checksum ? "IPFS deliverable with SHA-256 checksum" : "IPFS content reference",
      checksum,
      ...ipfs,
    };
  }
  if (SHA256_REFERENCE.test(proof)) {
    return { type: "sha256", label: "SHA-256 integrity fingerprint", checksum };
  }
  return { type: "text", label: "Plain-text work proof" };
}

export function validateWorkProof(value) {
  const analysis = analyzeWorkProof(value);
  if (analysis.type === "empty") throw new Error("Enter a non-empty work proof.");
  if (analysis.type === "invalid") throw new Error(analysis.error);
  return analysis;
}
