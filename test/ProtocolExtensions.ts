import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "mocha";

describe("Escrow protocol extensions", function () {
  it("funds and settles an exact-value ERC-20 escrow", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("MockERC20");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await escrow.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 1_000_000n);
    await token.connect(buyer).approve(escrowAddress, 1_000_000n);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      1_000_000n,
      tokenAddress,
      deadline,
      2n
    );
    await escrow.connect(buyer).fundEscrow(0);
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);
    await escrow.connect(seller).approveRelease(0);

    expect(await token.balanceOf(seller.address)).to.equal(1_000_000n);
    expect((await escrow.deals(0)).remainingAmount).to.equal(0n);
    expect(await escrow.getStatus(0)).to.equal(2n);
  });

  it("rejects fee-on-transfer tokens without changing escrow state", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("FeeOnTransferToken");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await escrow.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 10_000n);
    await token.connect(buyer).approve(escrowAddress, 10_000n);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      10_000n,
      tokenAddress,
      deadline,
      2n
    );

    await expect(
      escrow.connect(buyer).fundEscrow(0)
    ).to.be.revertedWith("Unsupported fee-on-transfer token");
    expect(await escrow.getStatus(0)).to.equal(0n);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
  });

  it("preserves escrow accounting when an ERC-20 charges a fee on payout", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("OutboundFeeToken");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await escrow.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 10_000n);
    await token.connect(buyer).approve(escrowAddress, 10_000n);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      10_000n,
      tokenAddress,
      deadline,
      2n
    );
    await escrow.connect(buyer).fundEscrow(0);
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);

    await expect(
      escrow.connect(seller).approveRelease(0)
    ).to.be.revertedWith("Unsupported fee-on-transfer token");
    expect(await escrow.getStatus(0)).to.equal(4n);
    expect((await escrow.deals(0)).remainingAmount).to.equal(10_000n);
    expect(await token.balanceOf(escrowAddress)).to.equal(10_000n);
  });

  it("rejects false-return ERC-20 funding and payout without changing accounting", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("FalseReturnToken");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await escrow.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 10_000n);
    await token.connect(buyer).approve(escrowAddress, 10_000n);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      10_000n,
      tokenAddress,
      deadline,
      2n
    );

    await token.setFailures(false, true);
    await expect(escrow.connect(buyer).fundEscrow(0)).to.be.revertedWith(
      "Token transfer failed"
    );
    expect(await escrow.getStatus(0)).to.equal(0n);
    expect((await escrow.deals(0)).remainingAmount).to.equal(10_000n);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);

    await token.setFailures(false, false);
    await escrow.connect(buyer).fundEscrow(0);
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);
    await token.setFailures(true, false);
    await expect(escrow.connect(seller).approveRelease(0)).to.be.revertedWith(
      "Token transfer failed"
    );
    expect(await escrow.getStatus(0)).to.equal(4n);
    expect((await escrow.deals(0)).remainingAmount).to.equal(10_000n);
    expect(await token.balanceOf(escrowAddress)).to.equal(10_000n);
    expect(await token.balanceOf(seller.address)).to.equal(0n);
  });

  it("blocks ERC-20 transfer callbacks from reentering escrow funding and settlement", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const token = await ethers.deployContract("CallbackToken");
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await escrow.setSupportedToken(tokenAddress, true);
    await token.mint(buyer.address, 10_000n);
    await token.connect(buyer).approve(escrowAddress, 10_000n);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      10_000n,
      tokenAddress,
      deadline,
      2n
    );
    await token.configureCallback(
      escrowAddress,
      escrow.interface.encodeFunctionData("fundEscrow", [0n])
    );

    await escrow.connect(buyer).fundEscrow(0);
    expect(await token.callbackAttempted()).to.equal(true);
    expect(await token.callbackSucceeded()).to.equal(false);
    expect(await escrow.getStatus(0)).to.equal(1n);

    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);
    await escrow.connect(seller).approveRelease(0);
    expect(await token.callbackSucceeded()).to.equal(false);
    expect(await token.balanceOf(seller.address)).to.equal(10_000n);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
    expect(await escrow.getStatus(0)).to.equal(2n);
  });

  it("rejects repeated funding and settlement after a completed escrow", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);
    await escrow.connect(seller).approveRelease(0);

    await expect(
      escrow.connect(buyer).fundEscrow(0, { value: 100n })
    ).to.be.revertedWith("Escrow not awaiting funding");
    await expect(escrow.connect(seller).approveRelease(0)).to.be.revertedWith(
      "Not awaiting approval"
    );
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    expect(await escrow.getStatus(0)).to.equal(2n);
  });

  it("uses the configured multi-party approval threshold", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, coApprover] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await escrow.connect(buyer).createMultiPartyEscrow(
      seller.address,
      100n,
      ethers.ZeroAddress,
      deadline,
      [buyer.address, seller.address, coApprover.address],
      2n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);

    expect(await escrow.getStatus(0)).to.equal(4n);
    await escrow.connect(coApprover).approveRelease(0);
    expect(await escrow.getStatus(0)).to.equal(2n);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
  });

  it("requires a valid distinct approver set and threshold", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, coApprover] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await expect(
      escrow.connect(buyer).createMultiPartyEscrow(
        seller.address,
        100n,
        ethers.ZeroAddress,
        deadline,
        [buyer.address, seller.address, coApprover.address],
        4n
      )
    ).to.be.revertedWith("Invalid approval threshold");

    await expect(
      escrow.connect(buyer).createMultiPartyEscrow(
        seller.address,
        100n,
        ethers.ZeroAddress,
        deadline,
        [buyer.address, seller.address, seller.address],
        2n
      )
    ).to.be.revertedWith("Duplicate approver");
  });

  it("requires arbitrator allowlisting before accepting an ERC-20", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller, outsider] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow", [], arbitrator);
    const token = await ethers.deployContract("MockERC20");
    const tokenAddress = await token.getAddress();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await expect(
      escrow.connect(buyer).createEscrowWithTerms(
        seller.address,
        10n,
        tokenAddress,
        deadline,
        2n
      )
    ).to.be.revertedWith("Unsupported token");
    await expect(
      escrow.connect(outsider).setSupportedToken(tokenAddress, true)
    ).to.be.revertedWith("Only arbitrator");
    await escrow.connect(arbitrator).setSupportedToken(tokenAddress, true);
    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      10n,
      tokenAddress,
      deadline,
      2n
    );
    expect(await escrow.supportedTokens(tokenAddress)).to.equal(true);
  });

  it("requires explicit arbitrated resolution after a multi-party review deadline", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller, coApprover] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow", [], arbitrator);
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await escrow.connect(buyer).createMultiPartyEscrow(
      seller.address,
      100n,
      ethers.ZeroAddress,
      deadline,
      [buyer.address, seller.address, coApprover.address],
      2n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      escrow.releaseAfterTimeout(0)
    ).to.be.revertedWith("Multi-party timeout release disabled");
    await escrow.connect(coApprover).raiseDispute(0);
    await escrow.connect(arbitrator).resolveDispute(0, true);
    expect(await escrow.getStatus(0)).to.equal(2n);
  });

  it("supports partial milestone releases and pays only approved milestones", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await escrow.connect(buyer).createMilestoneEscrow(
      seller.address,
      ethers.ZeroAddress,
      deadline,
      [40n, 60n]
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitMilestone(0);
    await escrow.connect(buyer).approveMilestone(0);

    expect((await escrow.deals(0)).remainingAmount).to.equal(60n);
    expect(await escrow.getStatus(0)).to.equal(1n);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(60n);

    await escrow.connect(seller).submitMilestone(0);
    await escrow.connect(buyer).approveMilestone(0);
    expect((await escrow.deals(0)).remainingAmount).to.equal(0n);
    expect(await escrow.getStatus(0)).to.equal(2n);
  });

  it("lets the arbitrator decide the remaining balance of a disputed milestone", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await escrow.connect(buyer).createMilestoneEscrow(
      seller.address,
      ethers.ZeroAddress,
      deadline,
      [40n, 60n]
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitMilestone(0);
    await escrow.connect(buyer).approveMilestone(0);
    await escrow.connect(seller).submitMilestone(0);
    await escrow.connect(buyer).raiseDispute(0);

    const before = await ethers.provider.getBalance(buyer.address);
    await escrow.connect(arbitrator).resolveDispute(0, false);
    expect((await ethers.provider.getBalance(buyer.address)) - before).to.equal(60n);
    expect(await escrow.getStatus(0)).to.equal(3n);
  });

  it("permits buyer cancellation only before funding", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, outsider] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await expect(
      escrow.connect(outsider).cancelEscrow(0)
    ).to.be.revertedWith("Only buyer can cancel");
    await escrow.connect(buyer).cancelEscrow(0);
    expect(await escrow.getStatus(0)).to.equal(6n);
    await expect(
      escrow.connect(buyer).fundEscrow(0, { value: 100n })
    ).to.be.revertedWith("Escrow not awaiting funding");
  });

  it("refunds undelivered funds after the agreement deadline", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);

    await escrow.connect(buyer).createEscrowWithTerms(
      seller.address,
      100n,
      ethers.ZeroAddress,
      deadline,
      2n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);
    await expect(
      escrow.connect(seller).refundEscrow(0)
    ).to.be.revertedWith("Refund deadline not reached");
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    const before = await ethers.provider.getBalance(buyer.address);
    await escrow.connect(seller).refundEscrow(0);
    expect((await ethers.provider.getBalance(buyer.address)) - before).to.equal(100n);
    expect(await escrow.getStatus(0)).to.equal(3n);
  });

  it("creates signed agreements once and rejects nonce replay", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, relayer] = await ethers.getSigners();
    const escrow = await ethers.deployContract("Escrow");
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const domain = {
      name: "Universal Escrow",
      version: "1",
      chainId,
      verifyingContract: await escrow.getAddress(),
    };
    const types = {
      Agreement: [
        { name: "buyer", type: "address" },
        { name: "seller", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "token", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const value = {
      buyer: buyer.address,
      seller: seller.address,
      amount: 100n,
      token: ethers.ZeroAddress,
      deadline,
      nonce: 0n,
    };
    const buyerSignature = await buyer.signTypedData(domain, types, value);
    const sellerSignature = await seller.signTypedData(domain, types, value);

    await expect(
      escrow.connect(relayer).createSignedEscrow(
        buyer.address,
        seller.address,
        100n,
        ethers.ZeroAddress,
        deadline,
        0n,
        buyerSignature,
        buyerSignature
      )
    ).to.be.revertedWith("Invalid seller signature");
    expect(await escrow.agreementNonces(buyer.address)).to.equal(0n);

    await escrow.connect(relayer).createSignedEscrow(
      buyer.address,
      seller.address,
      100n,
      ethers.ZeroAddress,
      deadline,
      0n,
      buyerSignature,
      sellerSignature
    );
    expect(await escrow.agreementNonces(buyer.address)).to.equal(1n);
    await expect(
      escrow.connect(relayer).createSignedEscrow(
        buyer.address,
        seller.address,
        100n,
        ethers.ZeroAddress,
        deadline,
        0n,
        buyerSignature,
        sellerSignature
      )
    ).to.be.revertedWith("Invalid agreement nonce");
  });
});
