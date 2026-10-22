export function getAcceptJobEligibility(job, account) {
  if (!job) return { eligible: false, reason: "Load the job before accepting it." };
  if (job.state !== 1n) {
    return { eligible: false, reason: "This job must be FUNDED before it can be accepted." };
  }
  if (!account || job.freelancer.toLowerCase() !== account.toLowerCase()) {
    return { eligible: false, reason: "Select the assigned freelancer wallet in MetaMask." };
  }
  // FreelanceEscrow.acceptJob requires block.timestamp < deadline.
  if (job.blockchainTime >= job.deadline) {
    return { eligible: false, reason: "The job deadline has passed on the blockchain." };
  }
  return { eligible: true, reason: "" };
}
