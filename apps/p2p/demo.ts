import { network } from "hardhat";
import { Escrow, EscrowSdkError } from "../../sdk/index.js";

async function main(): Promise<void> {
  const { ethers } = await network.connect();
  const [buyer, seller, arbitrator, outsider] = await ethers.getSigners();
  const contract = await ethers.deployContract("Escrow", [], arbitrator);
  const token = await ethers.deployContract("MockERC20");
  const contractAddress = await contract.getAddress();
  const tokenAddress = await token.getAddress();
  await contract.connect(arbitrator).setSupportedToken(tokenAddress, true);
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest local block.");
  const deadline = BigInt(latest.timestamp + 3600);
  const tokens = { mUSDC: { address: tokenAddress, decimals: 6 } };

  const buyerSdk = new Escrow({
    chain: "hardhat-local",
    wallet: buyer,
    contractAddress,
    tokens,
  });
  const sellerSdk = new Escrow({
    chain: "hardhat-local",
    wallet: seller,
    contractAddress,
  });
  const outsiderSdk = new Escrow({
    chain: "hardhat-local",
    wallet: outsider,
    contractAddress,
  });
  const arbitratorSdk = new Escrow({
    chain: "hardhat-local",
    wallet: arbitrator,
    contractAddress,
  });

  await token.mint(buyer.address, 35_000_000n);

  const sale = await buyerSdk.createEscrow({
    seller: seller.address,
    amount: "10",
    token: "mUSDC",
    deadline,
  });
  const saleFunding = await buyerSdk.deposit(sale.id);
  await sellerSdk.submitDelivery(sale.id);
  let unauthorizedReleaseRejected = false;
  try {
    await outsiderSdk.release(sale.id);
  } catch (error) {
    if (
      !(error instanceof EscrowSdkError) ||
      error.code !== "TRANSACTION_FAILED"
    ) {
      throw error;
    }
    unauthorizedReleaseRejected = true;
    console.log("Unauthorized release rejected by escrow authorization.");
  }
  if (!unauthorizedReleaseRejected) {
    throw new Error("An outsider unexpectedly approved the P2P release.");
  }
  const buyerApproval = await buyerSdk.release(sale.id);
  const sellerApproval = await sellerSdk.release(sale.id);
  const releasedSale = await buyerSdk.getEscrow(sale.id);
  if (releasedSale.status !== "released" || releasedSale.remainingAmount !== 0n) {
    throw new Error("P2P seller settlement did not complete.");
  }

  const disputeDeal = await buyerSdk.createEscrow({
    seller: seller.address,
    amount: "25",
    token: "mUSDC",
    deadline,
  });
  const disputeFunding = await buyerSdk.deposit(disputeDeal.id);
  await sellerSdk.submitDelivery(disputeDeal.id);
  const dispute = await buyerSdk.dispute(
    disputeDeal.id,
    "The received item differs from the listing.",
  );
  const resolution = await arbitratorSdk.resolve(disputeDeal.id, false);
  const refundedDeal = await buyerSdk.getEscrow(disputeDeal.id);
  if (refundedDeal.status !== "refunded" || refundedDeal.remainingAmount !== 0n) {
    throw new Error("P2P disputed escrow was not refunded.");
  }

  console.log("P2P successful sale:");
  console.log(`Escrow ID: ${sale.id}; status: ${releasedSale.status}`);
  console.log(`Seller token balance: ${await token.balanceOf(seller.address)}`);
  console.log(`Funding tx: ${saleFunding.hash}`);
  console.log(`Buyer approval tx: ${buyerApproval.hash}`);
  console.log(`Seller approval tx: ${sellerApproval.hash}`);
  console.log("P2P disputed sale:");
  console.log(`Escrow ID: ${disputeDeal.id}; status: ${refundedDeal.status}`);
  console.log(`Buyer token balance: ${await token.balanceOf(buyer.address)}`);
  console.log(`Funding tx: ${disputeFunding.hash}`);
  console.log(`Dispute tx: ${dispute.hash}`);
  console.log(`Arbitrator resolution tx: ${resolution.hash}`);
}

main().catch((error: unknown) => {
  console.error("P2P marketplace demo failed:", error);
  process.exitCode = 1;
});
