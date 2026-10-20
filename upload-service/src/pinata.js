import { PublicError } from "./security.js";

const PINATA_SIGN_URL = "https://uploads.pinata.cloud/v3/files/sign";

export async function createPinataSignedUploadUrl({ config, identity, fetchImpl = fetch, now = () => Date.now() }) {
  if (!config.pinataJwt) {
    throw new PublicError(503, "File uploads are not configured on this server.");
  }
  let response;
  try {
    response = await fetchImpl(PINATA_SIGN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.pinataJwt}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(config.pinataRequestTimeoutMs),
      body: JSON.stringify({
        network: "public",
        date: Math.floor(now() / 1000),
        expires: config.signedUploadTtlSeconds,
        max_file_size: identity.file.size,
        allow_mime_types: [identity.file.type],
        filename: identity.file.name,
        cid_version: "v1",
        keyvalues: {
          application: "freelance-escrow",
          jobId: identity.jobId,
          freelancer: identity.walletAddress.toLowerCase(),
          sha256: identity.file.sha256,
        },
      }),
    });
  } catch {
    throw new PublicError(502, "The upload provider is unavailable or timed out.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicError(502, "The upload provider returned an unreadable response.");
  }
  if (!response.ok || typeof payload?.data !== "string" || !payload.data.startsWith("https://uploads.pinata.cloud/")) {
    throw new PublicError(502, "The upload provider could not issue a signed upload URL.");
  }
  return payload.data;
}
