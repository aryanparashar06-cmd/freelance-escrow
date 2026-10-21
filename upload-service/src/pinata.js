import { openAsBlob } from "node:fs";
import { CID } from "multiformats/cid";
import { PublicError } from "./security.js";

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

function validCid(value) {
  try {
    return CID.parse(value).toString();
  } catch {
    return "";
  }
}

export async function uploadFileToPinata({ config, identity, filePath, fetchImpl = fetch, openBlob = openAsBlob }) {
  if (!config.pinataJwt) throw new PublicError(503, "File uploads are not configured on this server.");

  const form = new FormData();
  const blob = await openBlob(filePath, { type: identity.file.type });
  form.append("file", blob, identity.file.name);
  form.append("network", "public");
  form.append("name", `escrow-job-${identity.jobId}-${identity.file.name}`);
  form.append("keyvalues", JSON.stringify({
    application: "freelance-escrow",
    jobId: identity.jobId,
    freelancer: identity.walletAddress.toLowerCase(),
    sha256: identity.file.sha256,
    malwareScan: "clamav-no-threats-detected",
  }));
  form.append("cid_version", "v1");

  let response;
  try {
    response = await fetchImpl(PINATA_UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.pinataJwt}` },
      signal: AbortSignal.timeout(config.pinataRequestTimeoutMs),
      body: form,
    });
  } catch {
    throw new PublicError(502, "The IPFS provider is unavailable or timed out.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicError(502, "The IPFS provider returned an unreadable response.");
  }
  const cid = validCid(payload?.data?.cid || "");
  if (!response.ok || !cid) throw new PublicError(502, "The IPFS provider did not accept the scanned file.");
  return { cid, providerFileId: typeof payload?.data?.id === "string" ? payload.data.id : "" };
}
