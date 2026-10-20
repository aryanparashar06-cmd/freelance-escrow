import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { createAuthorizationService } from "../src/authorization.js";
import { loadConfig } from "../src/config.js";
import { createPinataSignedUploadUrl } from "../src/pinata.js";
import { ChallengeStore, validateUploadMetadata } from "../src/security.js";

const config = loadConfig({
  PINATA_JWT: "server-secret",
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

test("authorizes the assigned freelancer for an accepted job and returns only a short-lived URL", async () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({
    config,
    chainVerifier: verifierFor(wallet.address),
    pinataSigner: async ({ identity }) => {
      assert.equal(identity.jobId, "7");
      return "https://uploads.pinata.cloud/v3/files/restricted";
    },
  });
  const { input, context } = await signedAuthorization(service, wallet);
  const result = await service.authorize(input, context);
  assert.equal(result.uploadUrl, "https://uploads.pinata.cloud/v3/files/restricted");
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});

test("rejects invalid signatures and consumes a challenge to prevent replay", async () => {
  const wallet = Wallet.createRandom();
  const attacker = Wallet.createRandom();
  const challengeStore = new ChallengeStore({ ttlSeconds: 300 });
  const service = createAuthorizationService({
    config,
    challengeStore,
    chainVerifier: verifierFor(wallet.address),
    pinataSigner: async () => "https://uploads.pinata.cloud/v3/files/restricted",
  });
  const input = requestFor(wallet.address);
  const context = { ip: "127.0.0.1", origin: "http://127.0.0.1:5173" };
  const challenge = service.createChallenge(input, context);
  const signed = { ...input, challengeId: challenge.challengeId, signature: await attacker.signMessage(challenge.message) };
  await assert.rejects(() => service.authorize(signed, context), /does not match/i);
  await assert.rejects(() => service.authorize(signed, context), /already used/i);
});

test("rejects an unauthorized wallet and a job in the wrong state", async () => {
  const wallet = Wallet.createRandom();
  const another = Wallet.createRandom();
  const unauthorized = createAuthorizationService({
    config,
    chainVerifier: verifierFor(another.address),
    pinataSigner: async () => "https://uploads.pinata.cloud/v3/files/restricted",
  });
  let signed = await signedAuthorization(unauthorized, wallet);
  await assert.rejects(() => unauthorized.authorize(signed.input, signed.context), /assigned freelancer/i);

  const wrongState = createAuthorizationService({
    config,
    chainVerifier: verifierFor(wallet.address, 3n),
    pinataSigner: async () => "https://uploads.pinata.cloud/v3/files/restricted",
  });
  signed = await signedAuthorization(wrongState, wallet);
  await assert.rejects(() => wrongState.authorize(signed.input, signed.context), /ACCEPTED/i);
});

test("turns blockchain provider failures into a safe service error", async () => {
  const wallet = Wallet.createRandom();
  const service = createAuthorizationService({
    config,
    chainVerifier: async () => { throw new Error("RPC token details"); },
    pinataSigner: async () => "https://uploads.pinata.cloud/v3/files/restricted",
  });
  const signed = await signedAuthorization(service, wallet);
  await assert.rejects(
    () => service.authorize(signed.input, signed.context),
    (error) => error.status === 503 && /could not verify/i.test(error.message),
  );
});

test("rate limits repeated challenge creation", () => {
  const wallet = Wallet.createRandom();
  const limitedConfig = { ...config, rateLimitPerIp: 1, rateLimitPerWallet: 10 };
  const service = createAuthorizationService({
    config: limitedConfig,
    chainVerifier: verifierFor(wallet.address),
  });
  const input = requestFor(wallet.address);
  const context = { ip: "203.0.113.4", origin: "http://127.0.0.1:5173" };
  service.createChallenge(input, context);
  assert.throws(() => service.createChallenge(input, context), (error) => error.status === 429);
});

test("validates server-side file size and type", () => {
  assert.throws(
    () => validateUploadMetadata({ name: "malware.exe", size: 100, type: "application/x-msdownload", sha256: "a".repeat(64) }, config),
    /not allowed/i,
  );
  assert.throws(
    () => validateUploadMetadata({ name: "huge.pdf", size: config.maxFileBytes + 1, type: "application/pdf", sha256: "a".repeat(64) }, config),
    /File size/i,
  );
});

test("Pinata signing request binds public network, exact file limits, metadata, and expiry", async () => {
  let request;
  const identity = requestFor(Wallet.createRandom().address);
  const uploadUrl = await createPinataSignedUploadUrl({
    config,
    identity,
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ data: "https://uploads.pinata.cloud/v3/files/signed" }), { status: 200 });
    },
  });
  assert.equal(uploadUrl, "https://uploads.pinata.cloud/v3/files/signed");
  assert.equal(request.url, "https://uploads.pinata.cloud/v3/files/sign");
  assert.equal(request.options.headers.Authorization, "Bearer server-secret");
  assert.equal(request.body.network, "public");
  assert.equal(request.body.max_file_size, 1234);
  assert.deepEqual(request.body.allow_mime_types, ["application/pdf"]);
  assert.equal(request.body.expires, config.signedUploadTtlSeconds);
  assert.equal(request.body.keyvalues.sha256, "a".repeat(64));
});
