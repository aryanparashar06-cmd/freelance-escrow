import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import test from "node:test";
import { createSecureUploadService } from "../src/secureUpload.js";
import { receiveQuarantinedFile } from "../src/quarantine.js";
import { validateFileContent } from "../src/contentValidation.js";
import { uploadFileToPinata } from "../src/pinata.js";
import { scanFileWithClamAv } from "../src/scanner.js";
import { PublicError } from "../src/security.js";

const CID = "bafkreigh2akiscaildc6yuxm6v5l7c5iur7lqg6jm4x5q3l4q3l5q3l5qu";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identityFor(bytes, overrides = {}) {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001",
    jobId: "7",
    file: {
      name: "deliverable.pdf",
      type: "application/pdf",
      size: bytes.length,
      sha256: digest(bytes),
      ...overrides,
    },
  };
}

function multipartRequest(bytes, identity) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: identity.file.type }), identity.file.name);
  const response = new Response(form);
  const request = Readable.fromWeb(response.body);
  request.headers = Object.fromEntries(response.headers);
  return request;
}

async function temporaryConfig() {
  const quarantineDir = await mkdtemp(path.join(os.tmpdir(), "escrow-upload-test-"));
  return {
    quarantineDir,
    maxFileBytes: 1024 * 1024,
    pinataJwt: "test-only-placeholder",
    pinataRequestTimeoutMs: 1_000,
    clamavHost: "127.0.0.1",
    clamavPort: 3310,
    clamavScanTimeoutMs: 1_000,
  };
}

test("clean file is scanned before Pinata publication and quarantine is cleaned", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const identity = identityFor(PDF);
  const order = [];
  const service = createSecureUploadService({
    config,
    scan: async () => { order.push("scan"); return { status: "clean" }; },
    publish: async ({ filePath }) => {
      order.push("publish");
      assert.ok(filePath.startsWith(config.quarantineDir));
      return { cid: CID, providerFileId: "provider-id" };
    },
  });
  const result = await service.process({ request: multipartRequest(PDF, identity), identity });
  assert.deepEqual(order, ["scan", "publish"]);
  assert.equal(result.scanStatus, "no-threats-detected");
  assert.equal(result.sha256, identity.file.sha256);
  assert.equal(result.uri, `ipfs://${CID}`);
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("clean UTF-8 text passes quarantine validation, scanning, and publication", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const text = Buffer.from("Ordinary freelance deliverable notes.\n", "utf8");
  const identity = identityFor(text, { name: "deliverable.txt", type: "text/plain" });
  const order = [];
  const service = createSecureUploadService({
    config,
    scan: async () => { order.push("scan"); return { status: "clean" }; },
    publish: async () => { order.push("publish"); return { cid: CID }; },
  });
  const result = await service.process({ request: multipartRequest(text, identity), identity });
  assert.deepEqual(order, ["scan", "publish"]);
  assert.equal(result.sha256, identity.file.sha256);
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("malware detection blocks Pinata and cleans quarantine", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const identity = identityFor(PDF);
  let published = false;
  const service = createSecureUploadService({
    config,
    scan: async () => ({ status: "infected" }),
    publish: async () => { published = true; },
  });
  await assert.rejects(
    () => service.process({ request: multipartRequest(PDF, identity), identity }),
    (error) => error.status === 422 && /malware/i.test(error.message),
  );
  assert.equal(published, false);
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

for (const [name, message] of [
  ["scanner unavailable", "Scanner unavailable. Upload blocked."],
  ["scanner timeout", "Scanner timed out. Upload blocked."],
]) {
  test(`${name} fails closed and prevents Pinata publication`, async (t) => {
    const config = await temporaryConfig();
    t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
    const identity = identityFor(PDF);
    let published = false;
    const service = createSecureUploadService({
      config,
      scan: async () => { throw new PublicError(503, message); },
      publish: async () => { published = true; },
    });
    await assert.rejects(
      () => service.process({ request: multipartRequest(PDF, identity), identity }),
      (error) => error.status === 503 && error.message === message,
    );
    assert.equal(published, false);
    assert.deepEqual(await readdir(config.quarantineDir), []);
  });
}

test("actual received bytes must match the wallet-authorized SHA-256", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const identity = identityFor(PDF, { sha256: "0".repeat(64) });
  await assert.rejects(
    () => receiveQuarantinedFile({ request: multipartRequest(PDF, identity), config, identity }),
    (error) => error.status === 400 && /SHA-256/i.test(error.message),
  );
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("multipart bytes above the authorized size are rejected and removed", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const identity = identityFor(PDF);
  const oversized = Buffer.concat([PDF, Buffer.from("extra")]);
  await assert.rejects(
    () => receiveQuarantinedFile({ request: multipartRequest(oversized, identity), config, identity }),
    (error) => error.status === 413 && /exceeds/i.test(error.message),
  );
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("spoofed executable bytes declared as PDF are rejected before scanning or publication", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const executable = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(256)]);
  const identity = identityFor(executable);
  let scanned = false;
  let published = false;
  const service = createSecureUploadService({
    config,
    scan: async () => { scanned = true; return { status: "clean" }; },
    publish: async () => { published = true; },
  });
  await assert.rejects(
    () => service.process({ request: multipartRequest(executable, identity), identity }),
    (error) => error.status === 415 && /signature/i.test(error.message),
  );
  assert.equal(scanned, false);
  assert.equal(published, false);
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("content validator rejects active PDF actions", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "escrow-active-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("%PDF-1.4\n/OpenAction 1 0 R\n/JavaScript (alert)\n%%EOF");
  const filePath = path.join(directory, "active.pdf");
  await writeFile(filePath, bytes);
  await assert.rejects(
    () => validateFileContent({ filePath, identity: identityFor(bytes) }),
    (error) => error.status === 415 && /Active or executable/i.test(error.message),
  );
});

test("content validator does not treat ordinary visible PDF text as a PDF action", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "escrow-pdf-text-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from([
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj",
    "3 0 obj<</Length 38>>stream",
    "This report discusses javascript: links.",
    "endstream",
    "endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n"), "latin1");
  const filePath = path.join(directory, "visible-text.pdf");
  await writeFile(filePath, bytes);
  const result = await validateFileContent({ filePath, identity: identityFor(bytes) });
  assert.equal(result.detectedMime, "application/pdf");
});

test("server-side Pinata upload preserves checksum metadata and validates CID", async () => {
  let request;
  const identity = identityFor(PDF);
  const result = await uploadFileToPinata({
    config: { pinataJwt: "test-only-placeholder", pinataRequestTimeoutMs: 1_000 },
    identity,
    filePath: "unused-in-mock",
    openBlob: async () => new Blob([PDF], { type: "application/pdf" }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ data: { cid: CID, id: "provider-id" } }), { status: 200 });
    },
  });
  assert.equal(request.url, "https://uploads.pinata.cloud/v3/files");
  assert.equal(request.options.headers.Authorization, "Bearer test-only-placeholder");
  assert.equal(request.options.body.get("cid_version"), "v1");
  assert.equal(JSON.parse(request.options.body.get("keyvalues")).sha256, identity.file.sha256);
  assert.deepEqual(result, { cid: CID, providerFileId: "provider-id" });
});

test("server-side Pinata upload sends an actual quarantined file as multipart", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "escrow-pinata-form-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "deliverable.pdf");
  await writeFile(filePath, PDF);
  const identity = identityFor(PDF);
  let inspected = false;
  const result = await uploadFileToPinata({
    config: { pinataJwt: "test-only-placeholder", pinataRequestTimeoutMs: 1_000 },
    identity,
    filePath,
    fetchImpl: async (url, options) => {
      const file = options.body.get("file");
      assert.equal(url, "https://uploads.pinata.cloud/v3/files");
      assert.equal(options.body.get("network"), "public");
      assert.equal(file.name, identity.file.name);
      assert.equal(file.type, identity.file.type);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF);
      inspected = true;
      return new Response(JSON.stringify({ data: { cid: CID } }), { status: 200 });
    },
  });
  assert.equal(inspected, true);
  assert.equal(result.cid, CID);
});

test("Pinata provider rejection is converted to a safe error without exposing its response", async () => {
  const providerDetail = "provider-private-diagnostic";
  await assert.rejects(
    () => uploadFileToPinata({
      config: { pinataJwt: "test-only-placeholder", pinataRequestTimeoutMs: 1_000 },
      identity: identityFor(PDF),
      filePath: "unused-in-mock",
      openBlob: async () => new Blob([PDF], { type: "application/pdf" }),
      fetchImpl: async () => new Response(JSON.stringify({ error: providerDetail }), { status: 401 }),
    }),
    (error) => error.status === 502
      && /did not accept/i.test(error.message)
      && !error.message.includes(providerDetail),
  );
});

test("unreadable Pinata responses are converted to a safe provider error", async () => {
  await assert.rejects(
    () => uploadFileToPinata({
      config: { pinataJwt: "test-only-placeholder", pinataRequestTimeoutMs: 1_000 },
      identity: identityFor(PDF),
      filePath: "unused-in-mock",
      openBlob: async () => new Blob([PDF], { type: "application/pdf" }),
      fetchImpl: async () => new Response("not-json", { status: 502 }),
    }),
    (error) => error.status === 502 && /unreadable/i.test(error.message),
  );
});

test("Pinata network failures are converted to a safe unavailable error", async () => {
  const sensitiveDetail = "private-network-diagnostic";
  await assert.rejects(
    () => uploadFileToPinata({
      config: { pinataJwt: "test-only-placeholder", pinataRequestTimeoutMs: 1_000 },
      identity: identityFor(PDF),
      filePath: "unused-in-mock",
      openBlob: async () => new Blob([PDF], { type: "application/pdf" }),
      fetchImpl: async () => { throw new Error(sensitiveDetail); },
    }),
    (error) => error.status === 502
      && /unavailable or timed out/i.test(error.message)
      && !error.message.includes(sensitiveDetail),
  );
});

test("provider failure after a clean scan still removes the quarantined file", async (t) => {
  const config = await temporaryConfig();
  t.after(() => rm(config.quarantineDir, { recursive: true, force: true }));
  const identity = identityFor(PDF);
  const service = createSecureUploadService({
    config,
    scan: async () => ({ status: "clean" }),
    publish: async () => { throw new PublicError(502, "The IPFS provider is unavailable or timed out."); },
  });
  await assert.rejects(
    () => service.process({ request: multipartRequest(PDF, identity), identity }),
    (error) => error.status === 502 && /provider is unavailable/i.test(error.message),
  );
  assert.deepEqual(await readdir(config.quarantineDir), []);
});

test("ClamAV protocol timeout closes the scan and returns a safe blocked error", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "escrow-scan-timeout-"));
  const filePath = path.join(directory, "deliverable.pdf");
  await writeFile(filePath, PDF);
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await assert.rejects(
    () => scanFileWithClamAv({
      config: {
        clamavHost: "127.0.0.1",
        clamavPort: server.address().port,
        clamavScanTimeoutMs: 30,
      },
      filePath,
    }),
    (error) => error.status === 503 && /timed out.*blocked/i.test(error.message),
  );
});

test("real ClamAV rejects the harmless EICAR test signature when explicitly enabled", { skip: process.env.RUN_CLAMAV_INTEGRATION !== "true" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "escrow-eicar-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "eicar.com.txt");
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  await writeFile(filePath, eicar);
  const result = await scanFileWithClamAv({
    config: {
      clamavHost: process.env.CLAMAV_HOST || "127.0.0.1",
      clamavPort: Number(process.env.CLAMAV_PORT || 3310),
      clamavScanTimeoutMs: 30_000,
    },
    filePath,
  });
  assert.equal(result.status, "infected");
});
