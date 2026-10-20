import { network } from "hardhat";

type GasRow = {
  workflow: string;
  operation: string;
  v1Gas: bigint | null;
  v2Gas: bigint | null;
};

type TransactionLike = {
  wait(): Promise<{ gasUsed: bigint } | null>;
};

const TITLE = "Benchmark escrow job";
const WORK_PROOF = "ipfs://benchmark-work-proof";
const ESCROW_AMOUNT_ETH = "1";
const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
const REVIEW_PERIOD_SECONDS = 3 * 24 * 60 * 60;

const { ethers } = await network.create();
const [client, freelancer, arbitrator1, arbitrator2, arbitrator3] =
  await ethers.getSigners();

const escrowAmount = ethers.parseEther(ESCROW_AMOUNT_ETH);
const rows: GasRow[] = [];

async function gasUsed(transactionPromise: Promise<TransactionLike>): Promise<bigint> {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();

  if (receipt === null) {
    throw new Error("Transaction was not mined");
  }

  return receipt.gasUsed;
}

async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");

  if (block === null) {
    throw new Error("Latest block is unavailable");
  }

  return block.timestamp;
}

async function futureDeadline(): Promise<bigint> {
  return BigInt((await latestTimestamp()) + WEEK_IN_SECONDS);
}

async function deployV1() {
  const escrow = await ethers.deployContract("FreelanceEscrow");
  await escrow.waitForDeployment();
  return escrow;
}

async function deployV2() {
  const escrow = await ethers.deployContract("FreelanceEscrowV2");
  await escrow.waitForDeployment();
  return escrow;
}

async function createV1(escrow: Awaited<ReturnType<typeof deployV1>>, deadline: bigint) {
  return gasUsed(
    escrow
      .connect(client)
      .createJob(TITLE, freelancer.address, arbitrator1.address, deadline, {
        value: escrowAmount,
      }),
  );
}

async function createV2(escrow: Awaited<ReturnType<typeof deployV2>>, deadline: bigint) {
  return gasUsed(
    escrow
      .connect(client)
      .createJob(
        TITLE,
        freelancer.address,
        [arbitrator1.address, arbitrator2.address, arbitrator3.address],
        deadline,
        { value: escrowAmount },
      ),
  );
}

async function benchmarkDisputedWorkflows() {
  const v1 = await deployV1();
  const v2 = await deployV2();
  const v1Gas: bigint[] = [];
  const v2Gas: bigint[] = [];

  v1Gas.push(await createV1(v1, await futureDeadline()));
  v2Gas.push(await createV2(v2, await futureDeadline()));

  v1Gas.push(await gasUsed(v1.connect(freelancer).acceptJob(1n)));
  v2Gas.push(await gasUsed(v2.connect(freelancer).acceptJob(1n)));

  v1Gas.push(await gasUsed(v1.connect(freelancer).submitWork(1n, WORK_PROOF)));
  v2Gas.push(await gasUsed(v2.connect(freelancer).submitWork(1n, WORK_PROOF)));

  v1Gas.push(await gasUsed(v1.connect(client).raiseDispute(1n)));
  v2Gas.push(await gasUsed(v2.connect(client).raiseDispute(1n)));

  v1Gas.push(await gasUsed(v1.connect(arbitrator1).resolveDispute(1n, 2)));
  v2Gas.push(await gasUsed(v2.connect(arbitrator1).castDisputeVote(1n, 2)));
  v2Gas.push(await gasUsed(v2.connect(arbitrator2).castDisputeVote(1n, 2)));

  const operations = ["Create job", "Accept job", "Submit work", "Raise dispute"];

  operations.forEach((operation, index) => {
    rows.push({
      workflow: "Disputed release",
      operation,
      v1Gas: v1Gas[index],
      v2Gas: v2Gas[index],
    });
  });

  rows.push({
    workflow: "Disputed release",
    operation: "Resolve dispute",
    v1Gas: v1Gas[4],
    v2Gas: null,
  });
  rows.push({
    workflow: "Disputed release",
    operation: "Vote 1 (RELEASE)",
    v1Gas: null,
    v2Gas: v2Gas[4],
  });
  rows.push({
    workflow: "Disputed release",
    operation: "Vote 2 / finalize (RELEASE)",
    v1Gas: null,
    v2Gas: v2Gas[5],
  });
  rows.push({
    workflow: "Disputed release",
    operation: "TOTAL",
    v1Gas: v1Gas.reduce((total, value) => total + value, 0n),
    v2Gas: v2Gas.reduce((total, value) => total + value, 0n),
  });
}

async function prepareSubmittedV1() {
  const escrow = await deployV1();
  await createV1(escrow, await futureDeadline());
  await (await escrow.connect(freelancer).acceptJob(1n)).wait();
  await (await escrow.connect(freelancer).submitWork(1n, WORK_PROOF)).wait();
  return escrow;
}

async function prepareSubmittedV2() {
  const escrow = await deployV2();
  await createV2(escrow, await futureDeadline());
  await (await escrow.connect(freelancer).acceptJob(1n)).wait();
  await (await escrow.connect(freelancer).submitWork(1n, WORK_PROOF)).wait();
  return escrow;
}

async function benchmarkClientApproval() {
  const v1 = await prepareSubmittedV1();
  const v2 = await prepareSubmittedV2();

  rows.push({
    workflow: "Happy path",
    operation: "Client approval",
    v1Gas: await gasUsed(v1.connect(client).approveWork(1n)),
    v2Gas: await gasUsed(v2.connect(client).approveWork(1n)),
  });
}

async function benchmarkDeadlineRefund() {
  const v1 = await deployV1();
  const v2 = await deployV2();
  const v1Deadline = BigInt((await latestTimestamp()) + 60);

  await createV1(v1, v1Deadline);
  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);
  const v1RefundGas = await gasUsed(v1.connect(client).refundAfterDeadline(1n));

  const v2Deadline = BigInt((await latestTimestamp()) + 60);
  await createV2(v2, v2Deadline);
  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);
  const v2RefundGas = await gasUsed(v2.connect(client).refundAfterDeadline(1n));

  rows.push({
    workflow: "Deadline path",
    operation: "Deadline refund",
    v1Gas: v1RefundGas,
    v2Gas: v2RefundGas,
  });
}

async function benchmarkReviewTimeout() {
  const v1 = await prepareSubmittedV1();

  await ethers.provider.send("evm_increaseTime", [REVIEW_PERIOD_SECONDS + 1]);
  await ethers.provider.send("evm_mine", []);
  const v1ClaimGas = await gasUsed(
    v1.connect(freelancer).claimAfterReviewTimeout(1n),
  );

  const v2 = await prepareSubmittedV2();

  await ethers.provider.send("evm_increaseTime", [REVIEW_PERIOD_SECONDS + 1]);
  await ethers.provider.send("evm_mine", []);
  const v2ClaimGas = await gasUsed(
    v2.connect(freelancer).claimAfterReviewTimeout(1n),
  );

  rows.push({
    workflow: "Review timeout path",
    operation: "Freelancer timeout claim",
    v1Gas: v1ClaimGas,
    v2Gas: v2ClaimGas,
  });
}

function printableGas(value: bigint | null): string {
  return value === null ? "-" : value.toString();
}

await benchmarkDisputedWorkflows();
await benchmarkClientApproval();
await benchmarkDeadlineRefund();
await benchmarkReviewTimeout();

const { chainId } = await ethers.provider.getNetwork();

console.log("\nFreelance Escrow V1 vs V2 gas benchmark");
console.log(`Chain ID: ${chainId.toString()}`);
console.log("Solidity profile: default (0.8.28, optimizer disabled)");
console.log(`Escrow value: ${ESCROW_AMOUNT_ETH} ETH`);
console.log(`Title bytes: ${Buffer.byteLength(TITLE, "utf8")}`);
console.log(`Work proof bytes: ${Buffer.byteLength(WORK_PROOF, "utf8")}`);
console.log("Gas source: successful transaction receipt.gasUsed");

console.table(
  rows.map((row) => ({
    Workflow: row.workflow,
    Operation: row.operation,
    "V1 gas": printableGas(row.v1Gas),
    "V2 gas": printableGas(row.v2Gas),
    "V2 - V1":
      row.v1Gas === null || row.v2Gas === null
        ? "-"
        : (row.v2Gas - row.v1Gas).toString(),
  })),
);

console.log("\nMachine-readable results:");
console.log(
  JSON.stringify(
    rows.map((row) => ({
      workflow: row.workflow,
      operation: row.operation,
      v1Gas: row.v1Gas?.toString() ?? null,
      v2Gas: row.v2Gas?.toString() ?? null,
    })),
    null,
    2,
  ),
);
