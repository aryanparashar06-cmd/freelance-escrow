import { network } from "hardhat";

const { ethers } = await network.create("localhost");
const { chainId } = await ethers.provider.getNetwork();
const [deployer] = await ethers.getSigners();

console.log("Deployer address:", deployer.address);
console.log("Chain ID:", chainId.toString());

const escrow = await ethers.deployContract("FreelanceEscrow", [], deployer);
await escrow.waitForDeployment();

console.log("FreelanceEscrow address:", await escrow.getAddress());
