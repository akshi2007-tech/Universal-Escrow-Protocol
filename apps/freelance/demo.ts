import { network } from "hardhat";
import { Escrow } from "../../sdk/index.js";

async function main(): Promise<void> {
  const { ethers } = await network.connect();
  const [buyer, seller] = await ethers.getSigners();
  const contract = await ethers.deployContract("Escrow");
  const contractAddress = await contract.getAddress();
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest local block.");

  const buyerSdk = new Escrow({
    chain: "hardhat-local",
    wallet: buyer,
    contractAddress,
  });
  const sellerSdk = new Escrow({
    chain: "hardhat-local",
    wallet: seller,
    contractAddress,
  });
  const created = await buyerSdk.createMilestoneEscrow({
    seller: seller.address,
    token: "ETH",
    deadline: BigInt(latest.timestamp + 3600),
    milestoneAmounts: ["0.004", "0.006"],
  });
  const funded = await buyerSdk.deposit(created.id);
  const milestones = [];
  for (let index = 0; index < 2; index += 1) {
    const submitted = await sellerSdk.submitMilestone(created.id);
    const approved = await buyerSdk.approveMilestone(created.id);
    milestones.push({ submitted, approved });
    const state = await buyerSdk.getEscrow(created.id);
    console.log(
      `Milestone ${index + 1}: ${state.status}, remaining ${state.remainingAmount} wei`,
    );
  }

  const deal = await buyerSdk.getEscrow(created.id);
  if (deal.status !== "released" || deal.remainingAmount !== 0n) {
    throw new Error("Freelance milestone escrow did not settle completely.");
  }
  console.log("Freelance milestone service completed and approved in two tranches.");
  console.log(`Escrow ID: ${created.id}`);
  console.log(`Final status: ${deal.status}`);
  console.log(`Created tx: ${created.hash}`);
  console.log(`Funded tx: ${funded.hash}`);
  for (const [index, milestone] of milestones.entries()) {
    console.log(`Milestone ${index + 1} submitted tx: ${milestone.submitted.hash}`);
    console.log(`Milestone ${index + 1} approved tx: ${milestone.approved.hash}`);
  }
}

main().catch((error: unknown) => {
  console.error("Freelance milestone demo failed:", error);
  process.exitCode = 1;
});
