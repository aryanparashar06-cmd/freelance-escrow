import { expect } from "chai";
import hre from "hardhat";

describe("FreelanceEscrow", function () {
  it("should revert timeout payment if freelancer rejects ETH", async function () {

  const { ethers } = await hre.network.create();

  const [client, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const rejectFreelancer =
    await ethers.deployContract(
      "RejectEtherFreelancer",
      [await escrow.getAddress()]
    );

  await rejectFreelancer.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Timeout Failure Test",
    await rejectFreelancer.getAddress(),
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await rejectFreelancer.accept(1);

  await rejectFreelancer.submit(
    1,
    "valid-proof"
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    rejectFreelancer.claim(1)
  ).to.be.revertedWith(
    "Payment transfer failed"
  );

  const job =
    await escrow.jobs(1);

  // Still SUBMITTED
  expect(job.state).to.equal(3n);

  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(amount);
});
  it("should keep dispute active if arbitrator release transfer fails", async function () {

  const { ethers } = await hre.network.create();

  const [client, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const rejectFreelancer =
    await ethers.deployContract(
      "RejectEtherFreelancer",
      [await escrow.getAddress()]
    );

  await rejectFreelancer.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Dispute Failure Test",
    await rejectFreelancer.getAddress(),
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await rejectFreelancer.accept(1);

  await rejectFreelancer.submit(
    1,
    "valid-proof"
  );

  await escrow
    .connect(client)
    .raiseDispute(1);

  // RELEASE = 2
  await expect(
    escrow
      .connect(arbitrator)
      .resolveDispute(1, 2)
  ).to.be.revertedWith(
    "Transfer failed"
  );

  const job =
    await escrow.jobs(1);

  // DISPUTED = 4
  expect(job.state).to.equal(4n);

  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(amount);
});
  it("should revert payment if freelancer rejects ETH", async function () {

  const { ethers } = await hre.network.create();

  const [client, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const rejectFreelancer =
    await ethers.deployContract(
      "RejectEtherFreelancer",
      [await escrow.getAddress()]
    );

  await rejectFreelancer.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Failed Payment Test",
    await rejectFreelancer.getAddress(),
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await rejectFreelancer.accept(1);

  await rejectFreelancer.submit(
    1,
    "valid-proof"
  );

  await expect(
    escrow
      .connect(client)
      .approveWork(1)
  ).to.be.revertedWith(
    "Payment transfer failed"
  );

  const job =
    await escrow.jobs(1);

  // SUBMITTED = 3
  expect(job.state).to.equal(3n);

  // ETH must remain in escrow
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(amount);
});
  it("should block a reentrancy attack during timeout payment", async function () {

  const { ethers } = await hre.network.create();

  const [client, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract(
      "FreelanceEscrow"
    );

  await escrow.waitForDeployment();

  const attacker =
    await ethers.deployContract(
      "ReentrantFreelancer",
      [
        await escrow.getAddress()
      ]
    );

  await attacker.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Security Test Job",
    await attacker.getAddress(),
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await attacker.accept(1);

  await attacker.submit(
    1,
    "malicious-proof"
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await attacker.attack(1);

  expect(
    await attacker.attackAttempted()
  ).to.equal(true);

  expect(
    await attacker.reentrySucceeded()
  ).to.equal(false);

  const job =
    await escrow.jobs(1);

  expect(
    job.state
  ).to.equal(5n);

  expect(
    await ethers.provider.getBalance(
      await attacker.getAddress()
    )
  ).to.equal(amount);

  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(0n);
});
  it("should prevent further workflow actions after a job is refunded", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract(
      "FreelanceEscrow"
    );

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);


  await escrow.connect(client).createJob(
    "Build Website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );


  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );


  await escrow
    .connect(client)
    .refundAfterDeadline(1);


  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(6n);


  // Freelancer cannot accept after refund
  await expect(
    escrow
      .connect(freelancer)
      .acceptJob(1)
  ).to.be.revertedWith(
    "Job is not funded"
  );


  // Client cannot refund twice
  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(1)
  ).to.be.revertedWith(
    "Refund not allowed"
  );
});
  it("should prevent further workflow actions after a job is released", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract(
      "FreelanceEscrow"
    );

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);


  await escrow.connect(client).createJob(
    "Build Website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "proof"
    );

  await escrow
    .connect(client)
    .approveWork(1);


  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(5n);


  // Cannot dispute after release
  await expect(
    escrow
      .connect(client)
      .raiseDispute(1)
  ).to.be.revertedWith(
    "Dispute not allowed"
  );


  // Cannot approve again
  await expect(
    escrow
      .connect(client)
      .approveWork(1)
  ).to.be.revertedWith(
    "Work is not submitted"
  );


  // Freelancer cannot claim again
  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Work is not submitted"
  );
});
  it("should conserve escrow balance across release and refund", async function () {

  const { ethers } = await hre.network.create();

  const [
    client,
    freelancer1,
    freelancer2,
    arbitrator
  ] = await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  const amount1 =
    ethers.parseEther("1");

  const amount2 =
    ethers.parseEther("2");


  await escrow.connect(client).createJob(
    "Completed Job",
    freelancer1.address,
    arbitrator.address,
    deadline,
    {
      value: amount1
    }
  );

  await escrow.connect(client).createJob(
    "Unfinished Job",
    freelancer2.address,
    arbitrator.address,
    deadline,
    {
      value: amount2
    }
  );


  // Initially 3 ETH
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(
    ethers.parseEther("3")
  );


  // Job 1 completed
  await escrow
    .connect(freelancer1)
    .acceptJob(1);

  await escrow
    .connect(freelancer1)
    .submitWork(
      1,
      "proof"
    );

  await escrow
    .connect(client)
    .approveWork(1);


  // Only Job 2's 2 ETH remain
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(amount2);


  // Move past deadline
  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );


  // Refund Job 2
  await escrow
    .connect(client)
    .refundAfterDeadline(2);


  // All escrow obligations settled
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(0n);


  const job1 =
    await escrow.jobs(1);

  const job2 =
    await escrow.jobs(2);

  expect(job1.state).to.equal(5n);
  expect(job2.state).to.equal(6n);
});
  it("should not change another job when one job is released", async function () {

  const { ethers } = await hre.network.create();

  const [
    client,
    freelancer1,
    freelancer2,
    arbitrator
  ] = await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);


  await escrow.connect(client).createJob(
    "Job One",
    freelancer1.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(client).createJob(
    "Job Two",
    freelancer2.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("2")
    }
  );


  await escrow
    .connect(freelancer1)
    .acceptJob(1);

  await escrow
    .connect(freelancer1)
    .submitWork(
      1,
      "proof-1"
    );

  await escrow
    .connect(client)
    .approveWork(1);


  const job2 =
    await escrow.jobs(2);


  expect(job2.client)
    .to.equal(client.address);

  expect(job2.freelancer)
    .to.equal(freelancer2.address);

  expect(job2.amount)
    .to.equal(
      ethers.parseEther("2")
    );

  // Still FUNDED
  expect(job2.state)
    .to.equal(1n);
});
  it("should keep funds of multiple jobs isolated", async function () {

  const { ethers } = await hre.network.create();

  const [
    client,
    freelancer1,
    freelancer2,
    arbitrator
  ] = await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount1 =
    ethers.parseEther("1");

  const amount2 =
    ethers.parseEther("2");


  // JOB 1
  await escrow.connect(client).createJob(
    "Job One",
    freelancer1.address,
    arbitrator.address,
    deadline,
    {
      value: amount1
    }
  );


  // JOB 2
  await escrow.connect(client).createJob(
    "Job Two",
    freelancer2.address,
    arbitrator.address,
    deadline,
    {
      value: amount2
    }
  );


  // Contract should hold 3 ETH
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(
    ethers.parseEther("3")
  );


  // Complete only Job 1
  await escrow
    .connect(freelancer1)
    .acceptJob(1);

  await escrow
    .connect(freelancer1)
    .submitWork(
      1,
      "proof-job-1"
    );

  await escrow
    .connect(client)
    .approveWork(1);


  // Job 1 released exactly 1 ETH.
  // Job 2's 2 ETH must remain locked.
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(
    amount2
  );


  const job1 =
    await escrow.jobs(1);

  const job2 =
    await escrow.jobs(2);


  // RELEASED
  expect(job1.state).to.equal(5n);

  // FUNDED
  expect(job2.state).to.equal(1n);

  expect(job2.amount).to.equal(amount2);
});
  // ==================================================
// REVIEW TIMEOUT TESTS
// ==================================================


// 1. Freelancer can claim after review period
it("should allow freelancer to claim after review timeout", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  // Advance more than 3 days
  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  const balanceBefore =
    await ethers.provider.getBalance(
      freelancer.address
    );

  await escrow
    .connect(freelancer)
    .claimAfterReviewTimeout(1);

  const balanceAfter =
    await ethers.provider.getBalance(
      freelancer.address
    );

  const job =
    await escrow.jobs(1);

  // RELEASED = 5
  expect(job.state).to.equal(5n);

  expect(
    balanceAfter
  ).to.be.greaterThan(
    balanceBefore
  );

  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(0n);
});


// 2. Cannot claim before review period
it("should reject timeout claim before review period passes", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Review period has not passed"
  );
});


// 3. Client cannot use freelancer claim
it("should reject timeout claim by client", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(client)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Only freelancer can claim"
  );
});


// 4. Cannot claim before work is submitted
it("should reject timeout claim before work submission", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Work is not submitted"
  );
});


// 5. Cannot bypass a dispute using timeout
it("should reject timeout claim after dispute is raised", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await escrow
    .connect(client)
    .raiseDispute(1);

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Work is not submitted"
  );
});


// 6. Cannot claim after client already paid
it("should reject timeout claim after payment was already released", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await escrow
    .connect(client)
    .approveWork(1);

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  ).to.be.revertedWith(
    "Work is not submitted"
  );
});


// 7. Nonexistent job
it("should reject timeout claim for nonexistent job", async function () {

  const { ethers } = await hre.network.create();

  const [, freelancer] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(999)
  ).to.be.revertedWith(
    "Job does not exist"
  );
});


// 8. Event verification
it("should emit ReviewTimeoutClaimed event correctly", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await ethers.provider.send(
    "evm_increaseTime",
    [3 * 24 * 60 * 60 + 100]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(freelancer)
      .claimAfterReviewTimeout(1)
  )
    .to.emit(
      escrow,
      "ReviewTimeoutClaimed"
    )
    .withArgs(
      1n,
      freelancer.address,
      amount
    );
});
  // ==================================================
// DISPUTE TESTS
// ==================================================


// 1. Client can raise dispute after submission
it("should allow client to raise a dispute", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await escrow
    .connect(client)
    .raiseDispute(1);

  const job =
    await escrow.jobs(1);

  // DISPUTED = 4
  expect(job.state).to.equal(4n);
});


// 2. Freelancer can also raise dispute
it("should allow freelancer to raise a dispute", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await escrow
    .connect(freelancer)
    .raiseDispute(1);

  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(4n);
});


// 3. Random wallet cannot raise dispute
it("should reject dispute by an unauthorized user", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator, attacker] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await expect(
    escrow
      .connect(attacker)
      .raiseDispute(1)
  ).to.be.revertedWith(
    "Only client or freelancer can dispute"
  );
});


// 4. Cannot dispute before work is submitted
it("should reject dispute before work submission", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await expect(
    escrow
      .connect(client)
      .raiseDispute(1)
  ).to.be.revertedWith(
    "Dispute not allowed"
  );
});


// 5. Cannot dispute nonexistent job
it("should reject dispute for a nonexistent job", async function () {

  const { ethers } = await hre.network.create();

  const [client] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  await expect(
    escrow
      .connect(client)
      .raiseDispute(999)
  ).to.be.revertedWith(
    "Job does not exist"
  );
});


// 6. Cannot raise same dispute twice
it("should reject raising the same dispute twice", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await escrow
    .connect(client)
    .raiseDispute(1);

  await expect(
    escrow
      .connect(client)
      .raiseDispute(1)
  ).to.be.revertedWith(
    "Dispute not allowed"
  );
});


// 7. Arbitrator can refund client
it("should allow arbitrator to resolve dispute with refund", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  // DisputeDecision.REFUND = 1
  await escrow
    .connect(arbitrator)
    .resolveDispute(1, 1);

  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(6n);

  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(0n);
});


// 8. Arbitrator can release payment to freelancer
it("should allow arbitrator to resolve dispute with release", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  const freelancerBalanceBefore =
    await ethers.provider.getBalance(
      freelancer.address
    );

  // DisputeDecision.RELEASE = 2
  await escrow
    .connect(arbitrator)
    .resolveDispute(1, 2);

  const freelancerBalanceAfter =
    await ethers.provider.getBalance(
      freelancer.address
    );

  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(5n);

  expect(
    freelancerBalanceAfter -
    freelancerBalanceBefore
  ).to.equal(amount);
});


// 9. Client cannot resolve their own dispute
it("should reject dispute resolution by non-arbitrator", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  await expect(
    escrow
      .connect(client)
      .resolveDispute(1, 1)
  ).to.be.revertedWith(
    "Only arbitrator can resolve"
  );
});


// 10. Arbitrator cannot resolve a job that is not disputed
it("should reject resolution when job is not disputed", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await expect(
    escrow
      .connect(arbitrator)
      .resolveDispute(1, 1)
  ).to.be.revertedWith(
    "Job is not disputed"
  );
});


// 11. NONE is not a valid arbitrator decision
it("should reject invalid dispute decision", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  // NONE = 0
  await expect(
    escrow
      .connect(arbitrator)
      .resolveDispute(1, 0)
  ).to.be.revertedWith(
    "Invalid decision"
  );
});


// 12. Resolved dispute cannot be resolved again
it("should reject resolving the same dispute twice", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  await escrow
    .connect(arbitrator)
    .resolveDispute(1, 2);

  await expect(
    escrow
      .connect(arbitrator)
      .resolveDispute(1, 2)
  ).to.be.revertedWith(
    "Job is not disputed"
  );
});


// 13. Verify DisputeRaised event
it("should emit DisputeRaised event correctly", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await expect(
    escrow.connect(client).raiseDispute(1)
  )
    .to.emit(
      escrow,
      "DisputeRaised"
    )
    .withArgs(
      1n,
      client.address
    );
});


// 14. Verify DisputeResolved event
it("should emit DisputeResolved event correctly", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await escrow.connect(freelancer).acceptJob(1);

  await escrow.connect(freelancer).submitWork(
    1,
    "https://github.com/example/project"
  );

  await escrow.connect(client).raiseDispute(1);

  await expect(
    escrow
      .connect(arbitrator)
      .resolveDispute(1, 2)
  )
    .to.emit(
      escrow,
      "DisputeResolved"
    )
    .withArgs(
      1n,
      arbitrator.address,
      2,
      freelancer.address,
      amount
    );
});
  // ==================================================
// DEADLINE REFUND TESTS
// ==================================================


// 1. Client receives refund if job was never accepted
it("should allow client to refund a funded job after deadline", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  const clientBalanceBefore =
    await ethers.provider.getBalance(
      client.address
    );

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await escrow
    .connect(client)
    .refundAfterDeadline(1);

  const clientBalanceAfter =
    await ethers.provider.getBalance(
      client.address
    );

  const job =
    await escrow.jobs(1);

  // REFUNDED = 6
  expect(job.state).to.equal(6n);

  // Client receives refund.
  // Exact difference isn't 1 ETH because client also pays gas.
  expect(
    clientBalanceAfter
  ).to.be.greaterThan(
    clientBalanceBefore
  );

  // Escrow is empty
  expect(
    await ethers.provider.getBalance(
      await escrow.getAddress()
    )
  ).to.equal(0n);
});


// 2. Refund also works if freelancer accepted
// but never submitted work
it("should allow refund after deadline for an accepted job with no submission", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await escrow
    .connect(client)
    .refundAfterDeadline(1);

  const job =
    await escrow.jobs(1);

  expect(job.state).to.equal(6n);
});


// 3. Client cannot refund before deadline
it("should reject refund before the deadline", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 3600);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(1)
  ).to.be.revertedWith(
    "Deadline has not passed"
  );
});


// 4. Freelancer or another user cannot request refund
it("should reject deadline refund by a non-client", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(freelancer)
      .refundAfterDeadline(1)
  ).to.be.revertedWith(
    "Only client can request refund"
  );
});


// 5. Client cannot use deadline refund
// after valid work was submitted
it("should reject deadline refund after work has been submitted", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await escrow
    .connect(freelancer)
    .acceptJob(1);

  // Valid submission BEFORE deadline
  await escrow
    .connect(freelancer)
    .submitWork(
      1,
      "https://github.com/example/project"
    );

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(1)
  ).to.be.revertedWith(
    "Refund not allowed"
  );
});


// 6. Same escrow cannot be refunded twice
it("should reject refunding the same job twice", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: ethers.parseEther("1")
    }
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  // First refund succeeds
  await escrow
    .connect(client)
    .refundAfterDeadline(1);

  // Second refund must fail
  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(1)
  ).to.be.revertedWith(
    "Refund not allowed"
  );
});


// 7. Nonexistent jobs cannot be refunded
it("should reject refund of a nonexistent job", async function () {

  const { ethers } = await hre.network.create();

  const [client] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(999)
  ).to.be.revertedWith(
    "Job does not exist"
  );
});


// 8. Verify RefundIssued event
it("should emit RefundIssued event correctly", async function () {

  const { ethers } = await hre.network.create();

  const [client, freelancer, arbitrator] =
    await ethers.getSigners();

  const escrow =
    await ethers.deployContract("FreelanceEscrow");

  await escrow.waitForDeployment();

  const latestBlock =
    await ethers.provider.getBlock("latest");

  const deadline =
    BigInt(latestBlock!.timestamp + 100);

  const amount =
    ethers.parseEther("1");

  await escrow.connect(client).createJob(
    "Build a portfolio website",
    freelancer.address,
    arbitrator.address,
    deadline,
    {
      value: amount
    }
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [200]
  );

  await ethers.provider.send(
    "evm_mine",
    []
  );

  await expect(
    escrow
      .connect(client)
      .refundAfterDeadline(1)
  )
    .to.emit(
      escrow,
      "RefundIssued"
    )
    .withArgs(
      1n,
      client.address,
      amount
    );
});

  // ==================================================
  // CREATE JOB TESTS
  // ==================================================

  it("should allow a client to create and fund a job", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    expect(await escrow.jobCount()).to.equal(1n);

    const job = await escrow.jobs(1);

    expect(job.client).to.equal(client.address);
    expect(job.freelancer).to.equal(freelancer.address);
    expect(job.arbitrator).to.equal(arbitrator.address);

    expect(job.amount).to.equal(
      ethers.parseEther("1")
    );

    // FUNDED = 1
    expect(job.state).to.equal(1n);

    const contractBalance =
      await ethers.provider.getBalance(
        await escrow.getAddress()
      );

    expect(contractBalance).to.equal(
      ethers.parseEther("1")
    );
  });


  it("should reject a job with zero payment", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        freelancer.address,
        arbitrator.address,
        deadline
      )
    ).to.be.revertedWith(
      "Payment must be greater than zero"
    );
  });


  it("should reject a job with a past deadline", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const pastDeadline =
      BigInt(latestBlock!.timestamp - 100);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        freelancer.address,
        arbitrator.address,
        pastDeadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Deadline must be in future"
    );
  });


  it("should reject when client is also the freelancer", async function () {
    const { ethers } = await hre.network.create();

    const [client, , arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        client.address,
        arbitrator.address,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Client cannot be freelancer"
    );
  });


  it("should reject when client is also the arbitrator", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        freelancer.address,
        client.address,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Client cannot be arbitrator"
    );
  });


  it("should reject when freelancer is also the arbitrator", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        freelancer.address,
        freelancer.address,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Arbitrator cannot be freelancer"
    );
  });


  it("should reject a zero freelancer address", async function () {
    const { ethers } = await hre.network.create();

    const [client, , arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        ethers.ZeroAddress,
        arbitrator.address,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Invalid freelancer"
    );
  });


  it("should reject a zero arbitrator address", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "Build a portfolio website",
        freelancer.address,
        ethers.ZeroAddress,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Invalid arbitrator"
    );
  });


  it("should reject an empty job title", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await expect(
      escrow.connect(client).createJob(
        "",
        freelancer.address,
        arbitrator.address,
        deadline,
        {
          value: ethers.parseEther("1")
        }
      )
    ).to.be.revertedWith(
      "Title cannot be empty"
    );
  });


  it("should emit JobCreated event correctly", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    const amount = ethers.parseEther("1");
    const title = "Build a portfolio website";

    await expect(
      escrow.connect(client).createJob(
        title,
        freelancer.address,
        arbitrator.address,
        deadline,
        {
          value: amount
        }
      )
    )
      .to.emit(escrow, "JobCreated")
      .withArgs(
        1n,
        client.address,
        freelancer.address,
        arbitrator.address,
        amount,
        deadline,
        title
      );
  });


  // ==================================================
  // ACCEPT JOB TESTS
  // ==================================================

  it("should allow the assigned freelancer to accept a funded job", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    const job = await escrow.jobs(1);

    // ACCEPTED = 2
    expect(job.state).to.equal(2n);
  });


  it("should reject acceptance by an unauthorized user", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator, attacker] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await expect(
      escrow.connect(attacker).acceptJob(1)
    ).to.be.revertedWith(
      "Only freelancer can accept"
    );
  });


  it("should reject acceptance of a nonexistent job", async function () {
    const { ethers } = await hre.network.create();

    const [, freelancer] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    await expect(
      escrow.connect(freelancer).acceptJob(999)
    ).to.be.revertedWith(
      "Job does not exist"
    );
  });


  it("should reject accepting the same job twice", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await expect(
      escrow.connect(freelancer).acceptJob(1)
    ).to.be.revertedWith(
      "Job is not funded"
    );
  });


  it("should reject acceptance after the deadline", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 100);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await ethers.provider.send(
      "evm_increaseTime",
      [200]
    );

    await ethers.provider.send(
      "evm_mine",
      []
    );

    await expect(
      escrow.connect(freelancer).acceptJob(1)
    ).to.be.revertedWith(
      "Deadline has passed"
    );
  });


  it("should emit JobAccepted event correctly", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await expect(
      escrow.connect(freelancer).acceptJob(1)
    )
      .to.emit(escrow, "JobAccepted")
      .withArgs(
        1n,
        freelancer.address
      );
  });


  // ==================================================
  // SUBMIT WORK TESTS
  // ==================================================

  it("should allow freelancer to submit work", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    const job = await escrow.jobs(1);

    expect(job.workProof).to.equal(
      "https://github.com/example/project"
    );

    expect(
      job.submittedAt
    ).to.be.greaterThan(0n);

    // SUBMITTED = 3
    expect(job.state).to.equal(3n);
  });


  it("should reject work submission by an unauthorized user", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator, attacker] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await expect(
      escrow
        .connect(attacker)
        .submitWork(
          1,
          "https://github.com/fake/project"
        )
    ).to.be.revertedWith(
      "Only freelancer can submit"
    );
  });


  it("should reject work submission for a nonexistent job", async function () {
    const { ethers } = await hre.network.create();

    const [, freelancer] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          999,
          "https://github.com/example/project"
        )
    ).to.be.revertedWith(
      "Job does not exist"
    );
  });


  it("should reject work submission before job acceptance", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          1,
          "https://github.com/example/project"
        )
    ).to.be.revertedWith(
      "Job is not accepted"
    );
  });


  it("should reject empty work proof", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          1,
          ""
        )
    ).to.be.revertedWith(
      "Work proof cannot be empty"
    );
  });


  it("should reject work submission after the deadline", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 100);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await ethers.provider.send(
      "evm_increaseTime",
      [200]
    );

    await ethers.provider.send(
      "evm_mine",
      []
    );

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          1,
          "https://github.com/example/project"
        )
    ).to.be.revertedWith(
      "Deadline has passed"
    );
  });


  it("should reject submitting work twice", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          1,
          "https://github.com/example/project-v2"
        )
    ).to.be.revertedWith(
      "Job is not accepted"
    );
  });


  it("should emit WorkSubmitted event", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await expect(
      escrow
        .connect(freelancer)
        .submitWork(
          1,
          "https://github.com/example/project"
        )
    ).to.emit(
      escrow,
      "WorkSubmitted"
    );
  });


  // ==================================================
  // APPROVE WORK / PAYMENT RELEASE TESTS
  // ==================================================

  it("should allow client to approve work and release payment", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    const amount =
      ethers.parseEther("1");

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: amount
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    const freelancerBalanceBefore =
      await ethers.provider.getBalance(
        freelancer.address
      );

    await escrow
      .connect(client)
      .approveWork(1);

    const freelancerBalanceAfter =
      await ethers.provider.getBalance(
        freelancer.address
      );

    const job =
      await escrow.jobs(1);

    // RELEASED = 5
    expect(job.state).to.equal(5n);

    expect(
      freelancerBalanceAfter -
      freelancerBalanceBefore
    ).to.equal(amount);

    expect(
      await ethers.provider.getBalance(
        await escrow.getAddress()
      )
    ).to.equal(0n);
  });


  it("should reject approval by the freelancer", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    await expect(
      escrow
        .connect(freelancer)
        .approveWork(1)
    ).to.be.revertedWith(
      "Only client can approve"
    );
  });


  it("should reject approval by an unauthorized user", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator, attacker] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    await expect(
      escrow
        .connect(attacker)
        .approveWork(1)
    ).to.be.revertedWith(
      "Only client can approve"
    );
  });


  it("should reject approval before work is submitted", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await expect(
      escrow
        .connect(client)
        .approveWork(1)
    ).to.be.revertedWith(
      "Work is not submitted"
    );
  });


  it("should reject approving the same job twice", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    await escrow
      .connect(client)
      .approveWork(1);

    await expect(
      escrow
        .connect(client)
        .approveWork(1)
    ).to.be.revertedWith(
      "Work is not submitted"
    );
  });


  it("should reject approval of a nonexistent job", async function () {
    const { ethers } = await hre.network.create();

    const [client] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    await expect(
      escrow
        .connect(client)
        .approveWork(999)
    ).to.be.revertedWith(
      "Job does not exist"
    );
  });


  it("should emit PaymentReleased event correctly", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 3600);

    const amount =
      ethers.parseEther("1");

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: amount
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    await expect(
      escrow
        .connect(client)
        .approveWork(1)
    )
      .to.emit(
        escrow,
        "PaymentReleased"
      )
      .withArgs(
        1n,
        client.address,
        freelancer.address,
        amount
      );
  });


  it("should allow approval after deadline if work was submitted on time", async function () {
    const { ethers } = await hre.network.create();

    const [client, freelancer, arbitrator] =
      await ethers.getSigners();

    const escrow =
      await ethers.deployContract("FreelanceEscrow");

    await escrow.waitForDeployment();

    const latestBlock =
      await ethers.provider.getBlock("latest");

    const deadline =
      BigInt(latestBlock!.timestamp + 100);

    await escrow.connect(client).createJob(
      "Build a portfolio website",
      freelancer.address,
      arbitrator.address,
      deadline,
      {
        value: ethers.parseEther("1")
      }
    );

    await escrow
      .connect(freelancer)
      .acceptJob(1);

    // Work is submitted before deadline
    await escrow
      .connect(freelancer)
      .submitWork(
        1,
        "https://github.com/example/project"
      );

    // Now move beyond deadline
    await ethers.provider.send(
      "evm_increaseTime",
      [200]
    );

    await ethers.provider.send(
      "evm_mine",
      []
    );

    // Approval should still succeed
    await escrow
      .connect(client)
      .approveWork(1);

    const job =
      await escrow.jobs(1);

    expect(job.state).to.equal(5n);
  });

});