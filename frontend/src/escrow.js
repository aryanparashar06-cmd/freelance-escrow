export const LOCAL_CHAIN_ID = 31337n;
export const ESCROW_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const ESCROW_ABI = [
  "function jobCount() view returns (uint256)",
  "function createJob(string _title, address _freelancer, address _arbitrator, uint256 _deadline) payable returns (uint256)",
  "function acceptJob(uint256 _jobId)",
  "function jobs(uint256) view returns (address client, address freelancer, address arbitrator, uint256 amount, string title, uint256 deadline, uint256 createdAt, uint256 submittedAt, string workProof, uint8 state)",
];
