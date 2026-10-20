import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "mocha";
import { Escrow, EscrowSdkError } from "../sdk/index.js";

describe("Escrow TypeScript SDK", function () {
  it("creates, funds, queries, approves, and decodes a real local escrow", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const sdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress: await contract.getAddress(),
    });
    const latest = await ethers.provider.getBlock("latest");
    const created = await sdk.createEscrow({
      seller: seller.address,
      amount: "0.0000000000000001",
      token: "ETH",
      deadline: BigInt(latest!.timestamp + 3600),
    });

    expect(created.id).to.equal(0n);
    expect(created.status).to.equal("confirmed");
    expect(created.events.some((event) => event.name === "EscrowCreated")).to.equal(true);

    const funded = await sdk.deposit(created.id);
    expect(funded.events.some((event) => event.name === "EscrowFunded")).to.equal(true);
    expect(await sdk.getStatus(created.id)).to.equal("funded");
    const state = await sdk.getEscrow(created.id);
    expect(state.buyer).to.equal(buyer.address);
    expect(state.amount).to.equal(100n);
    expect(state.remainingAmount).to.equal(100n);

    const sellerSdk = new Escrow({
      chain: "hardhat-local",
      wallet: seller,
      contractAddress: await contract.getAddress(),
    });
    await sellerSdk.submitDelivery(created.id);
    await sdk.release(created.id);
    const release = await sellerSdk.release(created.id);
    expect(release.events.some((event) => event.name === "EscrowReleased")).to.equal(true);
    expect(await sdk.getStatus(created.id)).to.equal("released");

    const transaction = await sdk.getTransaction(created.hash);
    expect(transaction.status).to.equal("confirmed");
    expect(transaction.events[0]?.name).to.equal("EscrowCreated");
  });

  it("uses configured token decimals and obtains ERC-20 allowance before funding", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrowContract = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("MockERC20");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrowContract.getAddress();
    const sdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress: escrowAddress,
      tokens: { mUSDC: { address: tokenAddress, decimals: 6 } },
    });
    const latest = await ethers.provider.getBlock("latest");

    await escrowContract.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 1_250_000n);
    const created = await sdk.createEscrow({
      seller: seller.address,
      amount: "1.25",
      token: "mUSDC",
      deadline: BigInt(latest!.timestamp + 3600),
    });
    const funded = await sdk.deposit(created.id);

    expect(funded.events[0]?.name).to.equal("EscrowFunded");
    expect(await token.balanceOf(escrowAddress)).to.equal(1_250_000n);
    expect((await sdk.getEscrow(created.id)).token).to.equal(tokenAddress);
  });

  it("creates an EIP-712 agreement from participant signatures", async function () {
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
    const latest = await ethers.provider.getBlock("latest");
    const terms = {
      buyer: buyer.address,
      seller: seller.address,
      amount: "0.0000000000000001",
      token: "ETH",
      deadline: BigInt(latest!.timestamp + 3600),
    };
    const buyerSignature = await buyerSdk.signAgreement(terms);
    const sellerSignature = await sellerSdk.signAgreement(terms);
    const created = await buyerSdk.createSignedEscrow({
      ...terms,
      buyerSignature: buyerSignature.signature,
      sellerSignature: sellerSignature.signature,
    });

    expect(created.id).to.equal(0n);
    expect(await buyerSdk.getAgreementNonce(buyer.address)).to.equal(1n);
    expect((await buyerSdk.getEscrow(created.id)).amount).to.equal(100n);
  });

  it("creates and settles a threshold-based multi-party escrow", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, coApprover] = await ethers.getSigners();
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
    const coApproverSdk = new Escrow({
      chain: "hardhat-local",
      wallet: coApprover,
      contractAddress,
    });
    const latest = await ethers.provider.getBlock("latest");
    const created = await buyerSdk.createMultiPartyEscrow({
      seller: seller.address,
      amount: "0.0000000000000001",
      token: "ETH",
      deadline: BigInt(latest!.timestamp + 3600),
      approvers: [buyer.address, seller.address, coApprover.address],
      approvalThreshold: 2,
    });
    await buyerSdk.deposit(created.id);
    await sellerSdk.submitDelivery(created.id);
    await buyerSdk.release(created.id);
    await coApproverSdk.release(created.id);

    const deal = await buyerSdk.getEscrow(created.id);
    expect(deal.multiParty).to.equal(true);
    expect(deal.approvalThreshold).to.equal(2n);
    expect(deal.status).to.equal("released");
  });

  it("creates and settles milestones using human-readable token amounts", async function () {
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
    const latest = await ethers.provider.getBlock("latest");
    const created = await buyerSdk.createMilestoneEscrow({
      seller: seller.address,
      token: "ETH",
      deadline: BigInt(latest!.timestamp + 3600),
      milestoneAmounts: [
        "0.00000000000000004",
        "0.00000000000000006",
      ],
    });
    await buyerSdk.deposit(created.id);
    await sellerSdk.submitMilestone(created.id);
    await buyerSdk.approveMilestone(created.id);
    await sellerSdk.submitMilestone(created.id);
    await buyerSdk.approveMilestone(created.id);

    const deal = await buyerSdk.getEscrow(created.id);
    expect(deal.milestoneMode).to.equal(true);
    expect(deal.amount).to.equal(100n);
    expect(deal.remainingAmount).to.equal(0n);
    expect(deal.status).to.equal("released");
  });

  it("rejects unsupported chains and unconfigured token symbols explicitly", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const contractAddress = await contract.getAddress();

    expect(
      () =>
        new Escrow({
          chain: "base",
          wallet: buyer,
          contractAddress,
        }),
    ).to.throw(EscrowSdkError);

    const sdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress,
    });
    let failure: unknown;
    try {
      await sdk.createEscrow({ seller: seller.address, amount: "1", token: "USDC" });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(EscrowSdkError);
    expect((failure as EscrowSdkError).code).to.equal("TOKEN_NOT_CONFIGURED");
  });

  it("does not hide contract authorization errors", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, outsider] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const buyerSdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress: await contract.getAddress(),
    });
    const outsiderSdk = new Escrow({
      chain: "hardhat-local",
      wallet: outsider,
      contractAddress: await contract.getAddress(),
    });
    const created = await buyerSdk.createEscrow({
      seller: seller.address,
      amount: "0.0000000000000001",
    });
    let failure: unknown;
    try {
      await outsiderSdk.deposit(created.id);
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(EscrowSdkError);
    expect((failure as EscrowSdkError).code).to.equal("TRANSACTION_FAILED");
  });

  it("reports pending, confirmed, and failed transaction states", async function () {
    const { ethers } = await network.connect();
    const [buyer, recipient] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const sdk = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress: await contract.getAddress(),
    });

    await ethers.provider.send("evm_setAutomine", [false]);
    let pendingHash: string | undefined;
    try {
      const pending = await buyer.sendTransaction({
        to: recipient.address,
        value: 1n,
      });
      pendingHash = pending.hash;
      expect((await sdk.getTransaction(pending.hash)).status).to.equal("pending");
      await ethers.provider.send("evm_mine", []);
      expect((await sdk.getTransaction(pending.hash)).status).to.equal("confirmed");
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }

    await ethers.provider.send("evm_setAutomine", [false]);
    let failedHash: string | undefined;
    try {
      const failed = await buyer.sendTransaction({
        to: await contract.getAddress(),
        data: contract.interface.encodeFunctionData("fundEscrow", [0n]),
        gasLimit: 1_000_000n,
      });
      failedHash = failed.hash;
      await ethers.provider.send("evm_mine", []);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    expect(failedHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    const failedDetails = await sdk.getTransaction(failedHash!);
    expect(failedDetails.status).to.equal("failed");
    expect(failedDetails.blockNumber).to.not.equal(null);
    expect(pendingHash).to.match(/^0x[0-9a-fA-F]{64}$/);
  });
});
