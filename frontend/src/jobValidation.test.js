import assert from "node:assert/strict";
import test from "node:test";
import { getAcceptJobEligibility } from "./jobValidation.js";

const FREELANCER = "0x0000000000000000000000000000000000000002";

function fundedJob(overrides = {}) {
  return {
    state: 1n,
    freelancer: FREELANCER,
    blockchainTime: 99n,
    deadline: 100n,
    ...overrides,
  };
}

test("acceptance is available to the assigned freelancer before the deadline", () => {
  assert.deepEqual(getAcceptJobEligibility(fundedJob(), FREELANCER), { eligible: true, reason: "" });
});

test("acceptance is blocked at the exact deadline to match the Solidity boundary", () => {
  const result = getAcceptJobEligibility(fundedJob({ blockchainTime: 100n }), FREELANCER);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /deadline has passed/i);
});

test("acceptance is blocked for the wrong state or wallet", () => {
  assert.match(getAcceptJobEligibility(fundedJob({ state: 2n }), FREELANCER).reason, /FUNDED/i);
  assert.match(
    getAcceptJobEligibility(fundedJob(), "0x0000000000000000000000000000000000000003").reason,
    /assigned freelancer/i,
  );
});
