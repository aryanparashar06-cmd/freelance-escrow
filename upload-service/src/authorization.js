import { ethers } from "ethers";
import {
  ChallengeStore,
  PublicError,
  UploadTokenStore,
  createRateLimiter,
  sameUploadIdentity,
  validateUploadIdentity,
} from "./security.js";

const JOBS_ABI = [
  "function jobs(uint256) view returns (address client, address freelancer, address arbitrator, uint256 amount, string title, uint256 deadline, uint256 createdAt, uint256 submittedAt, string workProof, uint8 state)",
];

export function createAuthorizationService({
  config,
  provider = new ethers.JsonRpcProvider(config.rpcUrl),
  challengeStore = new ChallengeStore({ ttlSeconds: config.challengeTtlSeconds }),
  uploadTokenStore = new UploadTokenStore({ ttlSeconds: config.uploadTokenTtlSeconds }),
  chainVerifier,
}) {
  const ipLimiter = createRateLimiter({ limit: config.rateLimitPerIp, windowMs: config.rateLimitWindowMs });
  const walletLimiter = createRateLimiter({ limit: config.rateLimitPerWallet, windowMs: config.rateLimitWindowMs });

  function createChallenge(input, context) {
    const identity = validateUploadIdentity(input, config);
    ipLimiter.check(`challenge:${context.ip}`);
    walletLimiter.check(`challenge:${identity.walletAddress.toLowerCase()}`);
    return challengeStore.create(identity, {
      origin: context.origin,
      chainId: config.chainId.toString(),
      escrowAddress: config.escrowAddress,
    });
  }

  async function authorize(input, context) {
    const identity = validateUploadIdentity(input, config);
    ipLimiter.check(`authorize:${context.ip}`);
    walletLimiter.check(`authorize:${identity.walletAddress.toLowerCase()}`);
    if (typeof input.challengeId !== "string" || typeof input.signature !== "string") {
      throw new PublicError(400, "Challenge ID and wallet signature are required.");
    }

    const challenge = challengeStore.consume(input.challengeId);
    if (challenge.origin !== (context.origin || "") || !sameUploadIdentity(challenge.identity, identity)) {
      throw new PublicError(401, "Upload details do not match the signed challenge.");
    }
    let recovered;
    try {
      recovered = ethers.verifyMessage(challenge.message, input.signature);
    } catch {
      throw new PublicError(401, "Wallet signature is invalid.");
    }
    if (recovered.toLowerCase() !== identity.walletAddress.toLowerCase()) {
      throw new PublicError(401, "Wallet signature does not match the requested wallet.");
    }

    let job;
    let latestBlock;
    try {
      if (chainVerifier) {
        ({ job, latestBlock } = await chainVerifier(identity));
      } else {
        const network = await provider.getNetwork();
        if (network.chainId !== config.chainId) throw new PublicError(503, "Upload service is connected to the wrong blockchain network.");
        const code = await provider.getCode(config.escrowAddress);
        if (code === "0x") throw new PublicError(503, "Escrow contract is unavailable at the configured address.");
        const contract = new ethers.Contract(config.escrowAddress, JOBS_ABI, provider);
        [job, latestBlock] = await Promise.all([contract.jobs(identity.jobId), provider.getBlock("latest")]);
      }
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError(503, "The upload service could not verify the job on the configured blockchain.");
    }

    if (!latestBlock || job.state === 0n) throw new PublicError(404, "Job does not exist.");
    if (job.freelancer.toLowerCase() !== identity.walletAddress.toLowerCase()) {
      throw new PublicError(403, "Only the assigned freelancer can authorize this upload.");
    }
    if (job.state !== 2n) throw new PublicError(409, "The job must be ACCEPTED before a deliverable can be uploaded.");
    if (BigInt(latestBlock.timestamp) > job.deadline) {
      throw new PublicError(409, "The job deadline has passed.");
    }

    const issued = uploadTokenStore.create(identity);
    return {
      uploadToken: issued.token,
      expiresAt: issued.expiresAt,
      restrictions: { maxFileBytes: identity.file.size, mimeType: identity.file.type },
    };
  }

  function consumeUploadToken(token) {
    return uploadTokenStore.consume(token);
  }

  return { createChallenge, authorize, consumeUploadToken };
}
