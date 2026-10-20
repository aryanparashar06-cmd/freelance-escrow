import assert from "node:assert/strict";
import test from "node:test";
import { estimateGasCost } from "./gasCosts.js";

test("calculates an EIP-1559 maximum fee separately from gas units", async () => {
  const estimate = await estimateGasCost(
    { getFeeData: async () => ({ maxFeePerGas: 2_000_000_000n, gasPrice: 1_000_000_000n }) },
    async () => 21_000n,
  );

  assert.equal(estimate.gasLimit, "21000");
  assert.equal(estimate.feeRateGwei, "2");
  assert.equal(estimate.networkFeeEth, "0.000042");
  assert.match(estimate.feeLabel, /maximum/i);
});

test("uses legacy gas price when EIP-1559 fee data is unavailable", async () => {
  const estimate = await estimateGasCost(
    { getFeeData: async () => ({ maxFeePerGas: null, gasPrice: 3_000_000_000n }) },
    async () => 50_000n,
  );

  assert.equal(estimate.gasLimit, "50000");
  assert.equal(estimate.feeRateGwei, "3");
  assert.equal(estimate.networkFeeEth, "0.00015");
  assert.equal(estimate.feeLabel, "Estimated network fee");
});

test("still returns gas units when provider fee data cannot be read", async () => {
  const estimate = await estimateGasCost(
    { getFeeData: async () => { throw new Error("fee endpoint unavailable"); } },
    async () => 42_000n,
  );

  assert.equal(estimate.gasLimit, "42000");
  assert.equal(estimate.feeRateGwei, null);
  assert.equal(estimate.networkFeeEth, null);
});
