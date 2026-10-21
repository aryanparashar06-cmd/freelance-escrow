import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Busboy from "busboy";
import { PublicError } from "./security.js";

const MULTIPART_OVERHEAD_BYTES = 128 * 1024;

export async function receiveQuarantinedFile({ request, config, identity }) {
  const contentType = String(request.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new PublicError(415, "Content-Type must be multipart/form-data.");
  }
  const contentLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > identity.file.size + MULTIPART_OVERHEAD_BYTES) {
    throw new PublicError(413, "Upload request is larger than the authorized file.");
  }

  const baseDir = config.quarantineDir || path.join(os.tmpdir(), "freelance-escrow-quarantine");
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(baseDir, "upload-"));
  const filePath = path.join(directory, randomUUID());
  let parser;
  try {
    parser = Busboy({
      headers: request.headers,
      // Busboy emits `limit` when bytes reach the configured ceiling, so allow
      // one sentinel byte and enforce the exact signed length below.
      limits: { files: 2, fields: 1, parts: 2, fileSize: identity.file.size + 1 },
    });
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new PublicError(400, "Upload body is not valid multipart data.");
  }

  const hash = createHash("sha256");
  let bytes = 0;
  let seenFile = false;
  let filePromise;
  let rejected;

  const parsed = new Promise((resolve, reject) => {
    parser.on("file", (fieldName, stream, info) => {
      if (seenFile || fieldName !== "file") {
        stream.resume();
        rejected = new PublicError(400, "Upload must contain exactly one file field.");
        return;
      }
      seenFile = true;
      if (info.filename !== identity.file.name || info.mimeType.toLowerCase() !== identity.file.type) {
        stream.resume();
        rejected = new PublicError(400, "Uploaded file metadata does not match the signed authorization.");
        return;
      }
      const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
      filePromise = new Promise((fileResolve, fileReject) => {
        stream.on("data", (chunk) => {
          bytes += chunk.length;
          hash.update(chunk);
        });
        stream.once("limit", () => { rejected = new PublicError(413, "Uploaded file exceeds the authorized size."); });
        stream.once("error", fileReject);
        output.once("error", fileReject);
        output.once("finish", fileResolve);
      });
      stream.pipe(output);
    });
    parser.on("field", () => { rejected = new PublicError(400, "Unexpected multipart fields are not allowed."); });
    parser.once("filesLimit", () => { rejected = new PublicError(400, "Upload must contain exactly one file."); });
    parser.once("fieldsLimit", () => { rejected = new PublicError(400, "Unexpected multipart fields are not allowed."); });
    parser.once("partsLimit", () => { rejected = new PublicError(400, "Unexpected multipart content is not allowed."); });
    parser.once("error", () => reject(new PublicError(400, "Upload body is not valid multipart data.")));
    parser.once("close", resolve);
  });

  try {
    request.pipe(parser);
    await parsed;
    if (filePromise) await filePromise;
    if (rejected) throw rejected;
    if (!seenFile || !filePromise) throw new PublicError(400, "Upload must contain one file.");
    if (bytes !== identity.file.size) throw new PublicError(400, "Uploaded file size does not match the signed authorization.");
    const sha256 = hash.digest("hex");
    if (sha256 !== identity.file.sha256) throw new PublicError(400, "Uploaded file SHA-256 does not match the signed authorization.");
    return { directory, filePath, sha256, bytes };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error instanceof PublicError ? error : new PublicError(400, "The quarantined upload could not be received.");
  }
}

export async function removeQuarantine(directory) {
  await rm(directory, { recursive: true, force: true });
}
