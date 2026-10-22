import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { PublicError } from "./security.js";

const BINARY_MIME_EQUIVALENTS = new Map([
  ["application/x-zip-compressed", new Set(["application/zip"])],
]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "application/json"]);
const TEXT_ACTIVE_MARKERS = /(?:^|[\r\n])#!|<\s*(?:script|html|iframe|object|embed)\b|javascript\s*:/i;
const PDF_ACTIVE_MARKERS = /\/(?:JavaScript|JS|Launch|OpenAction|EmbeddedFile)\b/i;

function mimeMatches(declared, detected) {
  return declared === detected || BINARY_MIME_EQUIVALENTS.get(declared)?.has(detected);
}

async function readPrefix(filePath, maximum = 64 * 1024) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maximum);
    const { bytesRead } = await handle.read(buffer, 0, maximum, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function containsPattern(filePath, pattern) {
  let carry = "";
  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const text = carry + chunk.toString("latin1");
    if (pattern.test(text)) return true;
    carry = text.slice(-64);
  }
  return false;
}

export async function validateFileContent({ filePath, identity }) {
  let detected;
  try {
    detected = await fileTypeFromFile(filePath);
  } catch {
    throw new PublicError(415, "The file signature could not be inspected reliably.");
  }

  if (TEXT_TYPES.has(identity.file.type)) {
    if (detected) throw new PublicError(415, "The file signature does not match its declared text type.");
    const prefix = await readPrefix(filePath);
    if (prefix.includes(0)) throw new PublicError(415, "The selected text file contains unsupported binary content.");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    } catch {
      throw new PublicError(415, "Text uploads must contain valid UTF-8 content.");
    }
    if (identity.file.type === "application/json") {
      try {
        JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        throw new PublicError(415, "JSON uploads must contain valid JSON.");
      }
    }
  } else if (!detected || !mimeMatches(identity.file.type, detected.mime)) {
    throw new PublicError(415, "The file signature does not match the authorized MIME type.");
  }

  const activePattern = TEXT_TYPES.has(identity.file.type)
    ? TEXT_ACTIVE_MARKERS
    : detected?.mime === "application/pdf" ? PDF_ACTIVE_MARKERS : null;
  if (activePattern && await containsPattern(filePath, activePattern)) {
    throw new PublicError(415, "Active or executable content is not allowed in deliverable uploads.");
  }
  return { detectedMime: detected?.mime || identity.file.type };
}
