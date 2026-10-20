import { ethers } from "ethers";

function compactDecimal(value, maximumFractionDigits = 8) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString(undefined, {
    maximumFractionDigits,
    useGrouping: false,
  });
}

export async function estimateGasCost(provider, estimateGas) {
  const gasLimit = await estimateGas();
  let feeData;
  try {
    feeData = await provider.getFeeData();
  } catch {
    return {
      gasLimit: gasLimit.toString(),
      feeRateGwei: null,
      networkFeeEth: null,
      pricingLabel: "Current gas price",
      feeLabel: "Estimated network fee",
    };
  }
  const usesMaxFee = feeData.maxFeePerGas != null;
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;

  return {
    gasLimit: gasLimit.toString(),
    feeRateGwei: feePerGas == null
      ? null
      : compactDecimal(ethers.formatUnits(feePerGas, "gwei"), 6),
    networkFeeEth: feePerGas == null
      ? null
      : compactDecimal(ethers.formatEther(gasLimit * feePerGas), 10),
    pricingLabel: usesMaxFee ? "Current max fee per gas" : "Current gas price",
    feeLabel: usesMaxFee ? "Estimated maximum network fee" : "Estimated network fee",
  };
}
