import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "mocha";
import { Escrow, EscrowSdkError } from "../sdk/index.js";

describe("Marketplace reference workflows", function () {
  it("settles freelance work through sequential milestone approvals", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const contractAddress = await contract.getAddress();
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
    const block = await ethers.provider.getBlock("latest");
    const created = await buyerSdk.createMilestoneEscrow({
      seller: seller.address,
      token: "ETH",
      deadline: BigInt(block!.timestamp + 3600),
      milestoneAmounts: ["0.004", "0.006"],
    });

    await buyerSdk.deposit(created.id);
    await sellerSdk.submitMilestone(created.id);
    await buyerSdk.approveMilestone(created.id);
    const firstTranche = await buyerSdk.getEscrow(created.id);
    expect(firstTranche.status).to.equal("funded");
    expect(firstTranche.remainingAmount).to.equal(6_000_000_000_000_000n);

    await sellerSdk.submitMilestone(created.id);
    await buyerSdk.approveMilestone(created.id);
    const settled = await buyerSdk.getEscrow(created.id);
    expect(settled.status).to.equal("released");
    expect(settled.remainingAmount).to.equal(0n);
    expect(await ethers.provider.getBalance(contractAddress)).to.equal(0n);
  });

  it("settles a P2P token sale and rejects an outsider release approval", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, outsider] = await ethers.getSigners();
    const escrowContract = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("MockERC20");
    const contractAddress = await escrowContract.getAddress();
    const tokenAddress = await token.getAddress();
    await escrowContract.setSupportedToken(tokenAddress, true);
    const buyerSdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress,
      tokens: { mUSDC: { address: tokenAddress, decimals: 6 } },
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
    const block = await ethers.provider.getBlock("latest");
    await token.mint(buyer.address, 10_000_000n);
    const created = await buyerSdk.createEscrow({
      seller: seller.address,
      token: "mUSDC",
      amount: "10",
      deadline: BigInt(block!.timestamp + 3600),
    });
    await buyerSdk.deposit(created.id);
    await sellerSdk.submitDelivery(created.id);

    let unauthorizedRejected = false;
    try {
      await outsiderSdk.release(created.id);
    } catch (error) {
      expect(error).to.be.instanceOf(EscrowSdkError);
      expect((error as EscrowSdkError).code).to.equal("TRANSACTION_FAILED");
      unauthorizedRejected = true;
    }
    expect(unauthorizedRejected).to.equal(true);
    expect((await buyerSdk.getEscrow(created.id)).status).to.equal("delivered");

    await buyerSdk.release(created.id);
    await sellerSdk.release(created.id);
    const settled = await buyerSdk.getEscrow(created.id);
    expect(settled.status).to.equal("released");
    expect(settled.remainingAmount).to.equal(0n);
    expect(await token.balanceOf(seller.address)).to.equal(10_000_000n);
    expect(await token.balanceOf(contractAddress)).to.equal(0n);
  });

  it("preserves the P2P dispute and arbitrated refund workflow", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();
    const escrowContract = await ethers.deployContract("Escrow", [], arbitrator);
    const token = await ethers.deployContract("MockERC20");
    const contractAddress = await escrowContract.getAddress();
    const tokenAddress = await token.getAddress();
    await escrowContract.connect(arbitrator).setSupportedToken(tokenAddress, true);
    const buyerSdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress,
      tokens: { mUSDC: { address: tokenAddress, decimals: 6 } },
    });
    const sellerSdk = new Escrow({
      chain: "hardhat-local",
      wallet: seller,
      contractAddress,
    });
    const arbitratorSdk = new Escrow({
      chain: "hardhat-local",
      wallet: arbitrator,
      contractAddress,
    });
    const block = await ethers.provider.getBlock("latest");
    await token.mint(buyer.address, 25_000_000n);
    const created = await buyerSdk.createEscrow({
      seller: seller.address,
      token: "mUSDC",
      amount: "25",
      deadline: BigInt(block!.timestamp + 3600),
    });
    await buyerSdk.deposit(created.id);
    await sellerSdk.submitDelivery(created.id);
    await buyerSdk.dispute(created.id, "Item differs from listing.");
    await arbitratorSdk.resolve(created.id, false);

    const refunded = await buyerSdk.getEscrow(created.id);
    expect(refunded.status).to.equal("refunded");
    expect(refunded.remainingAmount).to.equal(0n);
    expect(await token.balanceOf(buyer.address)).to.equal(25_000_000n);
    expect(await token.balanceOf(contractAddress)).to.equal(0n);
  });
});
