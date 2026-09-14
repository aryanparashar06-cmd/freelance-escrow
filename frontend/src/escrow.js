export const LOCAL_CHAIN_ID = 31337n;
export const ESCROW_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const ESCROW_ABI = [
  "function jobCount() view returns (uint256)",
  "function createJob(string _title, address _freelancer, address _arbitrator, uint256 _deadline) payable returns (uint256)",
];
