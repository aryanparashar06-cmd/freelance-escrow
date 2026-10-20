import "./gasEstimate.css";

export default function GasEstimate({ estimate, valueNote = "Any ETH transferred by the contract is separate from this network fee." }) {
  if (!estimate) return null;

  return (
    <aside className="gas-estimate" aria-label="Estimated transaction gas">
      <div>
        <span>Estimated gas limit</span>
        <strong>{estimate.gasLimit} gas units</strong>
      </div>
      <div>
        <span>{estimate.pricingLabel}</span>
        <strong>{estimate.feeRateGwei ? `${estimate.feeRateGwei} Gwei` : "Unavailable from provider"}</strong>
      </div>
      <div>
        <span>{estimate.feeLabel}</span>
        <strong>{estimate.networkFeeEth ? `${estimate.networkFeeEth} ETH` : "Unavailable from provider"}</strong>
      </div>
      <p>Gas limit is the estimated computation allowance. The ETH fee uses current network pricing and may change before mining. {valueNote}</p>
    </aside>
  );
}
