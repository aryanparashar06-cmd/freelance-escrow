import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { createAuthorizationService } from "../src/authorization.js";
import { loadConfig } from "../src/config.js";
import { ChallengeStore, validateUploadMetadata } from "../src/security.js";
import { createUploadServer } from "../src/server.js";
import { PublicError } from "../src/security.js";

const config = loadConfig({
  PINATA_JWT: "test-only-placeholder",
  ESCROW_ADDRESS: "0x0000000000000000000000000000000000000009",
  CHAIN_ID: "31337",
  RATE_LIMIT_PER_IP: "100",
  RATE_LIMIT_PER_WALLET: "100",
});

function requestFor(walletAddress, overrides = {}) {
  return {
    walletAddress,
    jobId: "7",
    file: {
      name: "deliverable.pdf",
      type: "application/pdf",
      size: 1234,
      sha256: "a".repeat(64),
      ...overrides.file,
    },
    ...overrides,
  };
}

function verifierFor(walletAddress, state = 2n) {
  return async () => ({
    job: { freelancer: walletAddress, state, deadline: 2_000n },
    latestBlock: { timestamp: 1_000 },
  });
}

async function signedAuthorization(service, wallet, overrides = {}) {
  const input = requestFor(wallet.address, overrides);
  const context = { ip: "127.0.0.1", origin: "http://127.0.0.1:5173" };
  const challenge = service.createChallenge(input, context);
  return {
    input: { ...input, challengeId: challenge.challengeId, signature: await wallet.signMessage(challenge.message) },
    context,
  };
}

test("authorizes the assigned freelancer with a one-use backend token and never returns a direct Pinata URL", async () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({ config, chainVerifier: verifierFor(wallet.address) });
  const { input, context } = await signedAuthorization(service, wallet);
  const result = await service.authorize(input, context);
  assert.equal(typeof result.uploadToken, "string");
  assert.ok(result.uploadToken.length >= 32);
  assert.equal("uploadUrl" in result, false);
  assert.equal(JSON.stringify(result).includes(config.pinataJwt), false);
  assert.deepEqual(service.consumeUploadToken(result.uploadToken), requestFor(wallet.address));
  assert.throws(() => service.consumeUploadToken(result.uploadToken), /already used/i);
});

test("rejects invalid signatures and consumes a challenge to prevent replay", async () => {
  const wallet = Wallet.createRandom();
  const attacker = Wallet.createRandom();
  const service = createAuthorizationService({
    config,
    challengeStore: new ChallengeStore({ ttlSeconds: 300 }),
    chainVerifier: verifierFor(wallet.address),
  });
  const input = requestFor(wallet.address);
  const context = { ip: "127.0.0.1", origin: "http://127.0.0.1:5173" };
  const challenge = service.createChallenge(input, context);
  const signed = { ...input, challengeId: challenge.challengeId, signature: await attacker.signMessage(challenge.message) };
  await assert.rejects(() => service.authorize(signed, context), /does not match/i);
  await assert.rejects(() => service.authorize(signed, context), /already used/i);
});

test("rejects an unauthorized wallet and invalid job state", async () => {
  const wallet = Wallet.createRandom();
  const another = Wallet.createRandom();
  const unauthorized = createAuthorizationService({ config, chainVerifier: verifierFor(another.address) });
  let signed = await signedAuthorization(unauthorized, wallet);
  await assert.rejects(() => unauthorized.authorize(signed.input, signed.context), /assigned freelancer/i);

  const wrongState = createAuthorizationService({ config, chainVerifier: verifierFor(wallet.address, 3n) });
  signed = await signedAuthorization(wrongState, wallet);
  await assert.rejects(() => wrongState.authorize(signed.input, signed.context), /ACCEPTED/i);
});

test("rejects upload authorization after the on-chain deadline", async () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({
    config,
    chainVerifier: async () => ({
      job: { freelancer: wallet.address, state: 2n, deadline: 999n },
      latestBlock: { timestamp: 1_000 },
    }),
  });
  const signed = await signedAuthorization(service, wallet);
  await assert.rejects(() => service.authorize(signed.input, signed.context), /deadline has passed/i);
});

test("turns blockchain provider failures into a safe service error", async () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({ config, chainVerifier: async () => { throw new Error("internal RPC details"); } });
  const signed = await signedAuthorization(service, wallet);
  await assert.rejects(
    () => service.authorize(signed.input, signed.context),
    (error) => error.status === 503 && /could not verify/i.test(error.message) && !error.message.includes("RPC details"),
  );
});

test("rate limits repeated challenge creation", () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({
    config: { ...config, rateLimitPerIp: 1, rateLimitPerWallet: 10 },
    chainVerifier: verifierFor(wallet.address),
  });
  const input = requestFor(wallet.address);
  const context = { ip: "203.0.113.4", origin: "http://127.0.0.1:5173" };
  service.createChallenge(input, context);
  assert.throws(() => service.createChallenge(input, context), (error) => error.status === 429);
});

test("rejects oversized and disallowed file metadata", () => {
  assert.throws(
    () => validateUploadMetadata({ name: "malware.exe", size: 100, type: "application/x-msdownload", sha256: "a".repeat(64) }, config),
    /not allowed/i,
  );
  assert.throws(
    () => validateUploadMetadata({ name: "script.js", size: 100, type: "text/plain", sha256: "a".repeat(64) }, config),
    /active-content/i,
  );
  assert.throws(
    () => validateUploadMetadata({ name: "huge.pdf", size: config.maxFileBytes + 1, type: "application/pdf", sha256: "a".repeat(64) }, config),
    /File size/i,
  );
});

test("legacy signing endpoint is absent and secure upload requires a backend token", async (t) => {
  const server = createUploadServer({
    config,
    authorizationService: {
      consumeUploadToken() { throw new PublicError(401, "Upload authorization is missing or invalid."); },
    },
    secureUploadService: { process: async () => { throw new Error("must not run"); } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const legacy = await fetch(`http://127.0.0.1:${port}/v1/upload/sign`, { method: "POST" });
  assert.equal(legacy.status, 404);
  const missingToken = await fetch(`http://127.0.0.1:${port}/v1/upload`, { method: "POST" });
  assert.equal(missingToken.status, 401);
});
