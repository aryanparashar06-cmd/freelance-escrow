import { expect } from "chai";
import hre from "hardhat";

const FUNDED = 1n;
const ACCEPTED = 2n;
const SUBMITTED = 3n;
const DISPUTED = 4n;
const RELEASED = 5n;
const REFUNDED = 6n;
const REFUND = 1;
const RELEASE = 2;

describe("FreelanceEscrowV2", function () {
  async function deployFixture() {
    const { ethers } = await hre.network.create();
    const signers = await ethers.getSigners();
    const [client, freelancer, arbitrator1, arbitrator2, arbitrator3, outsider] = signers;
    const escrow = await ethers.deployContract("FreelanceEscrowV2");
    await escrow.waitForDeployment();

    return {
      ethers,
      escrow,
      signers,
      client,
      freelancer,
      arbitrator1,
      arbitrator2,
      arbitrator3,
      outsider,
      committee: [arbitrator1.address, arbitrator2.address, arbitrator3.address],
    };
  }

  async function futureDeadline(ethers: any, seconds = 3_600) {
    const latest = await ethers.provider.getBlock("latest");
    return BigInt(latest.timestamp + seconds);
  }

  async function createDefault(ctx: any, overrides: Record<string, any> = {}) {
    const title = overrides.title ?? "Build a secure dApp";
    const freelancer = overrides.freelancer ?? ctx.freelancer.address;
    const committee = overrides.committee ?? ctx.committee;
    const deadline = overrides.deadline ?? (await futureDeadline(ctx.ethers));
    const amount = overrides.amount ?? ctx.ethers.parseEther("1");
    const client = overrides.client ?? ctx.client;

    await ctx.escrow
      .connect(client)
      .createJob(title, freelancer, committee, deadline, { value: amount });

    return { title, freelancer, committee, deadline, amount, client };
  }

  async function submitDefault(ctx: any, jobId = 1) {
    await ctx.escrow.connect(ctx.freelancer).acceptJob(jobId);
    await ctx.escrow
      .connect(ctx.freelancer)
      .submitWork(jobId, "ipfs://bafy-valid-work-proof");
  }

  async function disputeDefault(ctx: any, jobId = 1) {
    await submitDefault(ctx, jobId);
    await ctx.escrow.connect(ctx.client).raiseDispute(jobId);
  }

  it("creates a funded job with exactly three valid arbitrators", async function () {
    const ctx = await deployFixture();
    const created = await createDefault(ctx);
    const job = await ctx.escrow.jobs(1);

    expect(job.client).to.equal(ctx.client.address);
    expect(job.freelancer).to.equal(ctx.freelancer.address);
    expect(job.amount).to.equal(created.amount);
    expect(job.state).to.equal(FUNDED);
    expect(await ctx.escrow.getArbitrators(1)).to.deep.equal(ctx.committee);
  });

  it("rejects duplicate arbitrators", async function () {
    const ctx = await deployFixture();
    const deadline = await futureDeadline(ctx.ethers);

    await expect(
      ctx.escrow.connect(ctx.client).createJob(
        "Invalid committee",
        ctx.freelancer.address,
        [ctx.arbitrator1.address, ctx.arbitrator1.address, ctx.arbitrator3.address],
        deadline,
        { value: ctx.ethers.parseEther("1") },
      ),
    ).to.be.revertedWith("Arbitrators must be distinct");
  });

  it("rejects client or freelancer membership in the committee", async function () {
    const ctx = await deployFixture();
    const deadline = await futureDeadline(ctx.ethers);
    const amount = ctx.ethers.parseEther("1");

    await expect(
      ctx.escrow.connect(ctx.client).createJob(
        "Client conflict",
        ctx.freelancer.address,
        [ctx.client.address, ctx.arbitrator2.address, ctx.arbitrator3.address],
        deadline,
        { value: amount },
      ),
    ).to.be.revertedWith("Client cannot be arbitrator");

    await expect(
      ctx.escrow.connect(ctx.client).createJob(
        "Freelancer conflict",
        ctx.freelancer.address,
        [ctx.arbitrator1.address, ctx.freelancer.address, ctx.arbitrator3.address],
        deadline,
        { value: amount },
      ),
    ).to.be.revertedWith("Freelancer cannot be arbitrator");
  });

  it("rejects zero addresses and invalid committee decisions", async function () {
    const ctx = await deployFixture();
    const deadline = await futureDeadline(ctx.ethers);

    await expect(
      ctx.escrow.connect(ctx.client).createJob(
        "Zero arbitrator",
        ctx.freelancer.address,
        [ctx.arbitrator1.address, ctx.ethers.ZeroAddress, ctx.arbitrator3.address],
        deadline,
        { value: ctx.ethers.parseEther("1") },
      ),
    ).to.be.revertedWith("Invalid arbitrator");

    await createDefault(ctx);
    await disputeDefault(ctx);
    await expect(
      ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, 0),
    ).to.be.revertedWith("Invalid decision");
  });

  it("rejects votes from addresses outside the designated committee", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await disputeDefault(ctx);

    await expect(
      ctx.escrow.connect(ctx.outsider).castDisputeVote(1, RELEASE),
    ).to.be.revertedWith("Only designated arbitrator can vote");
  });

  it("keeps escrow locked after a single vote", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);

    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([0n, 1n]);
    expect(await ctx.ethers.provider.getBalance(ctx.freelancer.address)).to.equal(
      freelancerBefore,
    );
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount,
    );
  });

  it("finalizes two RELEASE votes only to the registered freelancer", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);
    const outsiderBefore = await ctx.ethers.provider.getBalance(ctx.outsider.address);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);

    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect(
      (await ctx.ethers.provider.getBalance(ctx.freelancer.address)) - freelancerBefore,
    ).to.equal(amount);
    expect(await ctx.ethers.provider.getBalance(ctx.outsider.address)).to.equal(
      outsiderBefore,
    );
  });

  it("finalizes two REFUND votes only to the registered client", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);
    const clientBefore = await ctx.ethers.provider.getBalance(ctx.client.address);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, REFUND);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, REFUND);

    expect((await ctx.escrow.jobs(1)).state).to.equal(REFUNDED);
    expect((await ctx.ethers.provider.getBalance(ctx.client.address)) - clientBefore).to.equal(
      amount,
    );
  });

  it("does not settle on conflicting votes and settles only when a side reaches two", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, REFUND);

    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([1n, 1n]);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount,
    );

    await ctx.escrow.connect(ctx.arbitrator3).castDisputeVote(1, RELEASE);
    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
  });

  it("rejects duplicate votes from the same arbitrator", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await disputeDefault(ctx);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await expect(
      ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, REFUND),
    ).to.be.revertedWith("Arbitrator already voted");
  });

  it("rejects every vote after dispute resolution", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await disputeDefault(ctx);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);

    await expect(
      ctx.escrow.connect(ctx.arbitrator3).castDisputeVote(1, REFUND),
    ).to.be.revertedWith("Job is not disputed");
  });

  it("prevents double payout through all other settlement paths", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await disputeDefault(ctx);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);

    await expect(ctx.escrow.connect(ctx.client).approveWork(1)).to.be.revertedWith(
      "Work is not submitted",
    );
    await expect(
      ctx.escrow.connect(ctx.freelancer).claimAfterReviewTimeout(1),
    ).to.be.revertedWith("Work is not submitted");
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(0n);
  });

  it("refunds the client after the deadline when work was not submitted", async function () {
    const ctx = await deployFixture();
    const deadline = await futureDeadline(ctx.ethers, 100);
    const { amount } = await createDefault(ctx, { deadline });
    await ctx.escrow.connect(ctx.freelancer).acceptJob(1);
    expect((await ctx.escrow.jobs(1)).state).to.equal(ACCEPTED);

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline + 1n)]);
    const clientBefore = await ctx.ethers.provider.getBalance(ctx.client.address);
    const tx = await ctx.escrow.connect(ctx.client).refundAfterDeadline(1);
    const receipt = await tx.wait();
    if (receipt === null) {
      throw new Error("Refund transaction was not mined");
    }
    const gasCost = receipt.gasUsed * receipt.gasPrice;

    expect((await ctx.escrow.jobs(1)).state).to.equal(REFUNDED);
    expect(
      (await ctx.ethers.provider.getBalance(ctx.client.address)) - clientBefore + gasCost,
    ).to.equal(amount);
  });

  it("releases payment after the review timeout", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await submitDefault(ctx);
    const job = await ctx.escrow.jobs(1);
    const reviewPeriod = await ctx.escrow.REVIEW_PERIOD();

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [
      Number(job.submittedAt + reviewPeriod + 1n),
    ]);
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);
    const tx = await ctx.escrow.connect(ctx.freelancer).claimAfterReviewTimeout(1);
    const receipt = await tx.wait();
    if (receipt === null) {
      throw new Error("Review-timeout transaction was not mined");
    }
    const gasCost = receipt.gasUsed * receipt.gasPrice;

    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect(
      (await ctx.ethers.provider.getBalance(ctx.freelancer.address)) -
        freelancerBefore +
        gasCost,
    ).to.equal(amount);
  });

  it("blocks review-timeout withdrawal after a dispute is raised", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await disputeDefault(ctx);
    const job = await ctx.escrow.jobs(1);
    const reviewPeriod = await ctx.escrow.REVIEW_PERIOD();
    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [
      Number(job.submittedAt + reviewPeriod + 1n),
    ]);

    await expect(
      ctx.escrow.connect(ctx.freelancer).claimAfterReviewTimeout(1),
    ).to.be.revertedWith("Work is not submitted");
    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
  });

  it("keeps votes and escrow balances independent across jobs", async function () {
    const ctx = await deployFixture();
    const amount1 = ctx.ethers.parseEther("1");
    const amount2 = ctx.ethers.parseEther("2");
    await createDefault(ctx, { amount: amount1, title: "Job one" });
    await createDefault(ctx, { amount: amount2, title: "Job two" });
    await disputeDefault(ctx, 1);
    await disputeDefault(ctx, 2);

    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(2, REFUND);

    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect((await ctx.escrow.jobs(2)).state).to.equal(DISPUTED);
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([0n, 2n]);
    expect(await ctx.escrow.getVoteCounts(2)).to.deep.equal([1n, 0n]);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount2,
    );
  });

  it("blocks reentrant timeout claims and pays only once", async function () {
    const ctx = await deployFixture();
    const attacker = await ctx.ethers.deployContract("ReentrantFreelancer", [
      await ctx.escrow.getAddress(),
    ]);
    await attacker.waitForDeployment();
    const amount = ctx.ethers.parseEther("1");
    await createDefault(ctx, {
      freelancer: await attacker.getAddress(),
      amount,
    });
    await attacker.accept(1);
    await attacker.submit(1, "ipfs://reentrant-proof");
    const job = await ctx.escrow.jobs(1);
    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [
      Number(job.submittedAt + (await ctx.escrow.REVIEW_PERIOD()) + 1n),
    ]);

    await attacker.attack(1);

    expect(await attacker.attackAttempted()).to.equal(true);
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(await ctx.ethers.provider.getBalance(await attacker.getAddress())).to.equal(amount);
    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
  });

  it("reverts the final vote atomically when the freelancer rejects ETH", async function () {
    const ctx = await deployFixture();
    const rejector = await ctx.ethers.deployContract("RejectEtherFreelancer", [
      await ctx.escrow.getAddress(),
    ]);
    await rejector.waitForDeployment();
    const amount = ctx.ethers.parseEther("1");
    await createDefault(ctx, {
      freelancer: await rejector.getAddress(),
      amount,
    });
    await rejector.accept(1);
    await rejector.submit(1, "ipfs://reject-payment-proof");
    await ctx.escrow.connect(ctx.client).raiseDispute(1);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);

    await expect(
      ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE),
    ).to.be.revertedWith("Transfer failed");

    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([0n, 1n]);
    expect(await ctx.escrow.hasVoted(1, ctx.arbitrator2.address)).to.equal(false);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount,
    );
  });

  it("conserves deposited ETH across independent release and refund settlements", async function () {
    const ctx = await deployFixture();
    const amount1 = ctx.ethers.parseEther("1.25");
    const amount2 = ctx.ethers.parseEther("0.75");
    const contractAddress = await ctx.escrow.getAddress();
    await createDefault(ctx, { amount: amount1, title: "Release job" });
    await createDefault(ctx, { amount: amount2, title: "Refund job" });

    expect(await ctx.ethers.provider.getBalance(contractAddress)).to.equal(amount1 + amount2);

    await disputeDefault(ctx, 1);
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);
    expect((await ctx.ethers.provider.getBalance(ctx.freelancer.address)) - freelancerBefore).to.equal(
      amount1,
    );
    expect(await ctx.ethers.provider.getBalance(contractAddress)).to.equal(amount2);

    await disputeDefault(ctx, 2);
    const clientBefore = await ctx.ethers.provider.getBalance(ctx.client.address);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(2, REFUND);
    await ctx.escrow.connect(ctx.arbitrator3).castDisputeVote(2, REFUND);
    expect((await ctx.ethers.provider.getBalance(ctx.client.address)) - clientBefore).to.equal(
      amount2,
    );
    expect(await ctx.ethers.provider.getBalance(contractAddress)).to.equal(0n);
  });

  it("preserves normal client approval without invoking the committee", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await submitDefault(ctx);
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);

    await ctx.escrow.connect(ctx.client).approveWork(1);

    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect((await ctx.ethers.provider.getBalance(ctx.freelancer.address)) - freelancerBefore).to.equal(
      amount,
    );
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([0n, 0n]);
  });

  it("exposes no recipient parameter in the dispute vote ABI", async function () {
    const ctx = await deployFixture();
    const fragment = ctx.escrow.interface.getFunction("castDisputeVote");
    expect(fragment.inputs).to.have.length(2);
    expect(fragment.inputs[0].type).to.equal("uint256");
    expect(fragment.inputs[1].type).to.equal("uint8");
  });

  it("rejects lifecycle actions by unauthorized roles", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);

    await expect(ctx.escrow.connect(ctx.outsider).acceptJob(1)).to.be.revertedWith(
      "Only freelancer can accept",
    );
    await ctx.escrow.connect(ctx.freelancer).acceptJob(1);
    await expect(
      ctx.escrow.connect(ctx.outsider).submitWork(1, "fake proof"),
    ).to.be.revertedWith("Only freelancer can submit");
  });

  it("allows a new dispute at the exact review-period expiry timestamp", async function () {
    const ctx = await deployFixture();
    await createDefault(ctx);
    await submitDefault(ctx);
    const job = await ctx.escrow.jobs(1);
    const expiry = job.submittedAt + (await ctx.escrow.REVIEW_PERIOD());

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiry)]);
    await expect(ctx.escrow.connect(ctx.client).raiseDispute(1))
      .to.emit(ctx.escrow, "DisputeRaised")
      .withArgs(1n, ctx.client.address);

    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
  });

  it("rejects a new dispute after the review period has expired", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await submitDefault(ctx);
    const job = await ctx.escrow.jobs(1);
    const expiry = job.submittedAt + (await ctx.escrow.REVIEW_PERIOD());

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1n)]);
    await expect(ctx.escrow.connect(ctx.client).raiseDispute(1)).to.be.revertedWith(
      "Review period has expired",
    );

    expect((await ctx.escrow.jobs(1)).state).to.equal(SUBMITTED);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount,
    );
  });

  it("resolves an existing dispute after the review window expires", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);
    const job = await ctx.escrow.jobs(1);
    const expiry = job.submittedAt + (await ctx.escrow.REVIEW_PERIOD());
    const freelancerBefore = await ctx.ethers.provider.getBalance(ctx.freelancer.address);

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1n)]);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);

    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect(
      (await ctx.ethers.provider.getBalance(ctx.freelancer.address)) - freelancerBefore,
    ).to.equal(amount);
  });

  it("returns false from isArbitrator for missing jobs and the zero address", async function () {
    const ctx = await deployFixture();

    expect(await ctx.escrow.isArbitrator(999, ctx.arbitrator1.address)).to.equal(false);
    expect(await ctx.escrow.isArbitrator(999, ctx.ethers.ZeroAddress)).to.equal(false);

    await createDefault(ctx);
    expect(await ctx.escrow.isArbitrator(1, ctx.ethers.ZeroAddress)).to.equal(false);
    expect(await ctx.escrow.isArbitrator(1, ctx.arbitrator1.address)).to.equal(true);
    expect(await ctx.escrow.isArbitrator(1, ctx.outsider.address)).to.equal(false);
  });

  it("blocks reentrancy during the decisive dispute vote and pays once", async function () {
    const ctx = await deployFixture();
    const attacker = await ctx.ethers.deployContract("ReentrantVoteFreelancer", [
      await ctx.escrow.getAddress(),
    ]);
    await attacker.waitForDeployment();
    const amount = ctx.ethers.parseEther("1");

    await createDefault(ctx, {
      freelancer: await attacker.getAddress(),
      amount,
    });
    await attacker.accept(1);
    await attacker.submit(1, "ipfs://decisive-vote-reentrancy-proof");
    await ctx.escrow.connect(ctx.client).raiseDispute(1);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    await attacker.armAttack(1);

    await ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE);

    expect(await attacker.attackAttempted()).to.equal(true);
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(await attacker.receiveCount()).to.equal(1n);
    expect(await attacker.totalReceived()).to.equal(amount);
    expect((await ctx.escrow.jobs(1)).state).to.equal(RELEASED);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(0n);
    await expect(
      ctx.escrow.connect(ctx.arbitrator3).castDisputeVote(1, RELEASE),
    ).to.be.revertedWith("Job is not disputed");
  });

  it("emits complete vote and resolution events with the final counts and recipient", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);

    await expect(ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE))
      .to.emit(ctx.escrow, "DisputeVoteCast")
      .withArgs(1n, ctx.arbitrator1.address, 2n, 0n, 1n);

    await expect(ctx.escrow.connect(ctx.arbitrator2).castDisputeVote(1, RELEASE))
      .to.emit(ctx.escrow, "DisputeVoteCast")
      .withArgs(1n, ctx.arbitrator2.address, 2n, 0n, 2n)
      .and.to.emit(ctx.escrow, "DisputeResolved")
      .withArgs(1n, 2n, ctx.freelancer.address, amount);
  });

  it("keeps escrow locked when arbitration remains inactive", async function () {
    const ctx = await deployFixture();
    const { amount } = await createDefault(ctx);
    await disputeDefault(ctx);
    await ctx.escrow.connect(ctx.arbitrator1).castDisputeVote(1, RELEASE);
    const job = await ctx.escrow.jobs(1);
    const expiry = job.submittedAt + (await ctx.escrow.REVIEW_PERIOD());

    await ctx.ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1_000n)]);

    await expect(
      ctx.escrow.connect(ctx.freelancer).claimAfterReviewTimeout(1),
    ).to.be.revertedWith("Work is not submitted");
    await expect(ctx.escrow.connect(ctx.client).approveWork(1)).to.be.revertedWith(
      "Work is not submitted",
    );
    await expect(ctx.escrow.connect(ctx.client).refundAfterDeadline(1)).to.be.revertedWith(
      "Refund not allowed",
    );

    expect((await ctx.escrow.jobs(1)).state).to.equal(DISPUTED);
    expect(await ctx.escrow.getVoteCounts(1)).to.deep.equal([0n, 1n]);
    expect(await ctx.ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(
      amount,
    );
  });
});
