import assert from "node:assert/strict";
import test from "node:test";
import {
  requestUploadAuthorization,
  submitWorkProofTransaction,
  uploadFileToIpfs,
  validateDeliverableFile,
} from "./uploadClient.js";
import { MAX_HASH_FILE_BYTES } from "./workProof.js";

const ACCOUNT = "0x0000000000000000000000000000000000000001";
const CID = `Qm${"a".repeat(44)}`;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class MockXhr {
  constructor({ status = 200, response, fail = false } = {}) {
    this.status = status;
    this.responseText = response || JSON.stringify({ data: { id: "provider-file", cid: CID } });
    this.fail = fail;
    this.listeners = new Map();
    this.upload = { addEventListener: (name, listener) => this.listeners.set(`upload:${name}`, listener) };
  }
  open(method, url) { this.method = method; this.url = url; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  send(form) {
    this.form = form;
    queueMicrotask(() => {
      if (this.aborted) return;
      if (this.fail) this.listeners.get("error")?.();
      else {
        this.listeners.get("upload:progress")?.({ lengthComputable: true, loaded: 5, total: 10 });
        this.listeners.get("load")?.();
      }
    });
  }
  abort() {
    this.aborted = true;
    queueMicrotask(() => this.listeners.get("abort")?.());
  }
}

test("validates supported selection and rejects oversized or unsupported files", () => {
  assert.deepEqual(
    validateDeliverableFile({ name: "work.pdf", size: 42, type: "application/pdf" }),
    { name: "work.pdf", size: 42, type: "application/pdf" },
  );
  assert.throws(() => validateDeliverableFile({ name: "big.zip", size: MAX_HASH_FILE_BYTES + 1, type: "application/zip" }), /50 MB/i);
  assert.throws(() => validateDeliverableFile({ name: "run.exe", size: 10, type: "application/x-msdownload" }), /not allowed/i);
});

test("wallet authorization requests a challenge, signs it, and exchanges it once", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return calls.length === 1
      ? jsonResponse({ challengeId: "challenge-1", message: "bound challenge" }, 201)
      : jsonResponse({ uploadUrl: "https://uploads.pinata.cloud/v3/files/signed" });
  };
  const provider = { getSigner: async () => ({ signMessage: async (message) => `signature:${message}` }) };
  const result = await requestUploadAuthorization({
    provider,
    account: ACCOUNT,
    jobId: 7n,
    file: { name: "work.pdf", size: 42, type: "application/pdf" },
    sha256: "a".repeat(64),
    fetchImpl,
  });
  assert.equal(result.uploadUrl, "https://uploads.pinata.cloud/v3/files/signed");
  assert.equal(calls[1].body.challengeId, "challenge-1");
  assert.equal(calls[1].body.signature, "signature:bound challenge");
});

test("reports an upload authorization provider/network failure", async () => {
  await assert.rejects(
    () => requestUploadAuthorization({
      provider: {},
      account: ACCOUNT,
      jobId: 1n,
      file: { name: "work.pdf", size: 42, type: "application/pdf" },
      sha256: "a".repeat(64),
      fetchImpl: async () => { throw new Error("offline"); },
    }),
    /Cannot reach the upload authorization service/i,
  );
});

test("successful IPFS upload returns a CID without submitting a blockchain transaction", async () => {
  let progress = 0;
  let blockchainCalls = 0;
  const result = await uploadFileToIpfs({
    uploadUrl: "https://uploads.pinata.cloud/v3/files/signed",
    file: new Blob(["deliverable"], { type: "application/pdf" }),
    onProgress: (value) => { progress = value; },
    xhrFactory: () => new MockXhr(),
  });
  assert.equal(result.cid, CID);
  assert.equal(result.uri, `ipfs://${CID}`);
  assert.equal(progress, 100);
  assert.equal(blockchainCalls, 0);

  const contract = {
    submitWork: async (jobId, proof) => {
      blockchainCalls += 1;
      assert.equal(jobId, 7n);
      assert.equal(proof, result.uri);
      return { hash: "0xtx", wait: async () => ({ status: 1, blockNumber: 12 }) };
    },
  };
  const submitted = [];
  const confirmed = await submitWorkProofTransaction({
    contract,
    jobId: 7n,
    proof: result.uri,
    onSubmitted: (hash) => submitted.push(hash),
  });
  assert.equal(blockchainCalls, 1);
  assert.deepEqual(submitted, ["0xtx"]);
  assert.equal(confirmed.receipt.status, 1);
});

test("upload cancellation and provider failure are surfaced cleanly", async () => {
  const controller = new AbortController();
  const cancelled = uploadFileToIpfs({
    uploadUrl: "https://uploads.pinata.cloud/v3/files/signed",
    file: new Blob(["deliverable"]),
    signal: controller.signal,
    xhrFactory: () => new MockXhr(),
  });
  controller.abort();
  await assert.rejects(() => cancelled, /cancelled/i);

  await assert.rejects(
    () => uploadFileToIpfs({
      uploadUrl: "https://uploads.pinata.cloud/v3/files/signed",
      file: new Blob(["deliverable"]),
      xhrFactory: () => new MockXhr({ fail: true }),
    }),
    /network or provider/i,
  );
});
