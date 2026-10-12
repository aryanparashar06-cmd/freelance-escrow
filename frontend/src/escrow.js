const configuredChainId = import.meta.env.VITE_CHAIN_ID?.trim() || "31337";

export const LOCAL_CHAIN_ID = BigInt(configuredChainId);
export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME?.trim() || "Hardhat Localhost";
export const NETWORK_LABEL = `${NETWORK_NAME} (Chain ID: ${LOCAL_CHAIN_ID})`;
export const WRONG_NETWORK_MESSAGE = `Wrong network. Select ${NETWORK_LABEL} in MetaMask.`;
export const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS?.trim()
  || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const ESCROW_ABI = [
  "function jobCount() view returns (uint256)",
  "function createJob(string _title, address _freelancer, address _arbitrator, uint256 _deadline) payable returns (uint256)",
  "function acceptJob(uint256 _jobId)",
  "function submitWork(uint256 _jobId, string _workProof)",
  "function approveWork(uint256 _jobId)",
  "function raiseDispute(uint256 _jobId)",
  "function resolveDispute(uint256 _jobId, uint8 _decision)",
  "function refundAfterDeadline(uint256 _jobId)",
  "function claimAfterReviewTimeout(uint256 _jobId)",
  "function REVIEW_PERIOD() view returns (uint256)",
  "function jobs(uint256) view returns (address client, address freelancer, address arbitrator, uint256 amount, string title, uint256 deadline, uint256 createdAt, uint256 submittedAt, string workProof, uint8 state)",
];
