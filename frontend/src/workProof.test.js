import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_HASH_FILE_BYTES,
  analyzeWorkProof,
  calculateFileSha256,
  createIpfsGatewayUrl,
  parseIpfsReference,
} from "./workProof.js";

const VALID_LOOKING_CID_V0 = `Qm${"a".repeat(44)}`;

test("keeps ordinary proof text backward compatible", () => {
  assert.equal(analyzeWorkProof("https://github.com/example/deliverable").type, "text");
  assert.equal(analyzeWorkProof("Completed as agreed").type, "text");
});

test("recognizes a complete SHA-256 reference and rejects a malformed one", () => {
  assert.equal(analyzeWorkProof(`sha256:${"a".repeat(64)}`).type, "sha256");
  assert.equal(analyzeWorkProof("b".repeat(64)).type, "sha256");
  assert.equal(analyzeWorkProof("sha256:1234").type, "invalid");
});

test("accepts valid-looking IPFS formats without claiming content availability", () => {
  assert.equal(analyzeWorkProof(VALID_LOOKING_CID_V0).type, "ipfs");
  assert.equal(analyzeWorkProof(`ipfs://${VALID_LOOKING_CID_V0}`).type, "ipfs");
  assert.equal(
    parseIpfsReference(`ipfs://${VALID_LOOKING_CID_V0}/folder/file.pdf`).gatewayUrl,
    `https://ipfs.io/ipfs/${VALID_LOOKING_CID_V0}/folder/file.pdf`,
  );
});

test("recognizes an uploaded IPFS URI and recorded checksum in one proof", () => {
  const proof = `ipfs://${VALID_LOOKING_CID_V0}\nsha256:${"c".repeat(64)}`;
  const analysis = analyzeWorkProof(proof);
  assert.equal(analysis.type, "ipfs");
  assert.equal(analysis.cid, VALID_LOOKING_CID_V0);
  assert.equal(analysis.checksum, "c".repeat(64));
});

test("creates only HTTPS configured gateway links and encodes paths", () => {
  assert.equal(
    createIpfsGatewayUrl(VALID_LOOKING_CID_V0, ["client report.pdf"], "https://gateway.example/ipfs/"),
    `https://gateway.example/ipfs/${VALID_LOOKING_CID_V0}/client%20report.pdf`,
  );
  assert.throws(
    () => createIpfsGatewayUrl(VALID_LOOKING_CID_V0, [], "http://gateway.example/ipfs/"),
    /HTTPS/i,
  );
});

test("rejects malformed IPFS schemes and path traversal", () => {
  assert.match(parseIpfsReference("ipfs:broken").error, /ipfs:\/\//i);
  assert.match(parseIpfsReference(`ipfs://${VALID_LOOKING_CID_V0}/../secret`).error, /traversal/i);
});

test("calculates the standard SHA-256 digest without uploading the file", async () => {
  const digest = await calculateFileSha256(new Blob(["abc"]));
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("rejects files over the browser hashing limit before reading bytes", async () => {
  let readAttempted = false;
  const oversizedFile = {
    size: MAX_HASH_FILE_BYTES + 1,
    async arrayBuffer() {
      readAttempted = true;
      return new ArrayBuffer(0);
    },
  };

  await assert.rejects(() => calculateFileSha256(oversizedFile), /exceeds/i);
  assert.equal(readAttempted, false);
});
