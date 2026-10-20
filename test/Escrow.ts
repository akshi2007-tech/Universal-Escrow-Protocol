import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "mocha";

describe("Escrow", function () {
  it("creates an escrow with the correct buyer, seller, and amount", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);

    const deal = await escrow.deals(0);

    expect(deal.buyer).to.equal(buyer.address);
    expect(deal.seller).to.equal(seller.address);
    expect(deal.amount).to.equal(100n);
    expect(deal.status).to.equal(0n);
  });

  it("rejects an amount of zero", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await expect(
      escrow.connect(buyer).createEscrow(seller.address, 0n)
    ).to.be.revertedWith("Amount must be positive");
  });

  it("rejects the zero address as seller", async function () {
    const { ethers } = await network.connect();
    const [buyer] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await expect(
      escrow.connect(buyer).createEscrow(ethers.ZeroAddress, 100n)
    ).to.be.revertedWith("Invalid seller");
  });

  it("rejects the buyer as their own seller", async function () {
    const { ethers } = await network.connect();
    const [buyer] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await expect(
      escrow.connect(buyer).createEscrow(buyer.address, 100n)
    ).to.be.revertedWith("Buyer cannot be seller");
  });

  it("increments the escrow ID for each new deal", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).createEscrow(seller.address, 200n);

    expect(await escrow.nextDealId()).to.equal(2n);

    const firstDeal = await escrow.deals(0);
    const secondDeal = await escrow.deals(1);

    expect(firstDeal.amount).to.equal(100n);
    expect(secondDeal.amount).to.equal(200n);
  });

  it("allows the buyer to fund an escrow with the exact amount", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });

    const deal = await escrow.deals(0);

    expect(deal.status).to.equal(1n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);
  });

  it("rejects an incorrect funding amount", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);

    await expect(
      escrow.connect(buyer).fundEscrow(0, { value: 50n })
    ).to.be.revertedWith("Incorrect ETH amount");
  });

  it("prevents anyone other than the buyer from funding", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);

    await expect(
      escrow.connect(other).fundEscrow(0, { value: 100n })
    ).to.be.revertedWith("Only buyer can fund");
  });
});

  it("allows the buyer one 3-day review extension", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    const before = await escrow.deals(0);

    await escrow.connect(buyer).requestReviewExtension(0);

    const after = await escrow.deals(0);

    expect(after.reviewDeadline - before.reviewDeadline).to.equal(
      3n * 24n * 60n * 60n
    );
    expect(after.extensionUsed).to.equal(true);
  });

  it("rejects a second review extension", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).requestReviewExtension(0);

    await expect(
      escrow.connect(buyer).requestReviewExtension(0)
    ).to.be.revertedWith("Extension already used");
  });

  it("rejects an extension requested by the seller", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    await expect(
      escrow.connect(seller).requestReviewExtension(0)
    ).to.be.revertedWith("Only buyer can extend review");
  });

  it("rejects an extension requested by an unrelated account", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    await expect(
      escrow.connect(other).requestReviewExtension(0)
    ).to.be.revertedWith("Only buyer can extend review");
  });

  it("rejects an extension after the review deadline", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      escrow.connect(buyer).requestReviewExtension(0)
    ).to.be.revertedWith("Review period ended");
  });

  it("waits until the extended deadline before timeout release", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).requestReviewExtension(0);

    // Pass the original 3-day deadline, but not the extended deadline.
    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      escrow.releaseAfterTimeout(0)
    ).to.be.revertedWith("Review period active");

    // Now pass the extended deadline too.
    await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    await escrow.releaseAfterTimeout(0);

    const deal = await escrow.deals(0);
    expect(deal.status).to.equal(2n); // Released
  });

  it("does not release funds after only the buyer approves", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    await escrow.connect(buyer).approveRelease(0);

    const deal = await escrow.deals(0);

    expect(deal.buyerApproved).to.equal(true);
    expect(deal.sellerApproved).to.equal(false);
    expect(deal.status).to.equal(4n); // Delivered

    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);
  });

  it("releases funds only after both parties approve", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    // First approval alone must not release the payment.
    await escrow.connect(seller).approveRelease(0);

    expect((await escrow.deals(0)).status).to.equal(4n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);

    // The second approval triggers payment.
    await escrow.connect(buyer).approveRelease(0);

    const deal = await escrow.deals(0);

    expect(deal.buyerApproved).to.equal(true);
    expect(deal.sellerApproved).to.equal(true);
    expect(deal.status).to.equal(2n); // Released

    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });
  
  it("allows the buyer to raise a dispute during the review period", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    expect((await escrow.deals(0)).status).to.equal(5n); // Disputed
  });

  it("prevents timeout release while a dispute is active", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      escrow.releaseAfterTimeout(0)
    ).to.be.revertedWith("Not awaiting review");

    expect((await escrow.deals(0)).status).to.equal(5n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);
  });

  it("releases funds when both parties agree to resolve a dispute in the seller's favor", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await escrow.connect(buyer).approveDisputeResolution(0, true);
    expect((await escrow.deals(0)).status).to.equal(5n);

    await escrow.connect(seller).approveDisputeResolution(0, true);

    expect((await escrow.deals(0)).status).to.equal(2n); // Released
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });

  it("refunds the buyer when both parties agree to resolve a dispute in the buyer's favor", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await escrow.connect(buyer).approveDisputeResolution(0, false);
    await escrow.connect(seller).approveDisputeResolution(0, false);

    expect((await escrow.deals(0)).status).to.equal(3n); // Refunded
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });

  it("rejects conflicting dispute resolution votes", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
    

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await escrow.connect(buyer).approveDisputeResolution(0, true);

    await expect(
      escrow.connect(seller).approveDisputeResolution(0, false)
    ).to.be.revertedWith("Resolution mismatch");

    expect((await escrow.deals(0)).status).to.equal(5n);
  });
  
describe("Escrow Security Tests", function () {
  it("prevents an outsider from approving a release", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, outsider] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);

    await expect(
      escrow.connect(outsider).approveRelease(0)
    ).to.be.revertedWith("Not a party");

    expect((await escrow.deals(0)).status).to.equal(4n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);
  });

  it("prevents the buyer from approving release twice", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).approveRelease(0);

    await expect(
      escrow.connect(buyer).approveRelease(0)
    ).to.be.revertedWith("Buyer already approved");
  });

  it("prevents the seller from approving release twice", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(seller).approveRelease(0);

    await expect(
      escrow.connect(seller).approveRelease(0)
    ).to.be.revertedWith("Seller already approved");
  });

  it("prevents an outsider from voting on a dispute", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller, outsider] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await expect(
      escrow.connect(outsider).approveDisputeResolution(0, true)
    ).to.be.revertedWith("Not a party");

    expect((await escrow.deals(0)).status).to.equal(5n);
  });

  it("prevents a party from voting on a dispute twice", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(seller.address, 100n);
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);
    await escrow.connect(buyer).approveDisputeResolution(0, true);

    await expect(
      escrow.connect(buyer).approveDisputeResolution(0, true)
    ).to.be.revertedWith("Buyer already voted");

    expect((await escrow.deals(0)).status).to.equal(5n);
  });
});

it("keeps escrow funds protected when the seller rejects ETH", async function () {
  const { ethers } = await network.connect();
  const [buyer, outsider] = await ethers.getSigners();

  const RejectEther = await ethers.getContractFactory("RejectEther");
  const rejectEther = await RejectEther.deploy();
  await rejectEther.waitForDeployment();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const rejectAddress = await rejectEther.getAddress();

  await escrow.connect(buyer).createEscrow(rejectAddress, 100n);
  await escrow.connect(buyer).fundEscrow(0, { value: 100n });
  await rejectEther.submitDelivery(await escrow.getAddress(), 0);

  // An outsider cannot approve the release.
  await expect(
    escrow.connect(outsider).approveRelease(0)
  ).to.be.revertedWith("Not a party");

  // Advance beyond the review deadline.
  await ethers.provider.send("evm_increaseTime", [
    3 * 24 * 60 * 60 + 1
  ]);
  await ethers.provider.send("evm_mine", []);

  // The seller rejects ETH, so payment must fail.
  await expect(
    escrow.releaseAfterTimeout(0)
  ).to.be.revertedWith("Payment failed");

  // The failed transaction must preserve the funds and status.
  expect((await escrow.deals(0)).status).to.equal(4n);
  expect(
    await ethers.provider.getBalance(await escrow.getAddress())
  ).to.equal(100n);
});

it("prevents a reentrant seller from releasing escrow funds twice", async function () {
  const { ethers } = await network.connect();
  const [buyer] = await ethers.getSigners();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const Attacker = await ethers.getContractFactory("ReentrantAttacker");
  const attacker = await Attacker.deploy(
    await escrow.getAddress(),
    0
  );
  await attacker.waitForDeployment();

  const attackerAddress = await attacker.getAddress();
  const attackerContract = attacker as any;

  // Create and fund a deal with the attacker as seller.
  await escrow.connect(buyer).createEscrow(attackerAddress, 100n);
  await escrow.connect(buyer).fundEscrow(0, { value: 100n });

  // Attacker submits delivery.
  await attackerContract.submitDelivery();

  // Expire the review period.
  await ethers.provider.send("evm_increaseTime", [
    3 * 24 * 60 * 60 + 1
  ]);
  await ethers.provider.send("evm_mine", []);

  // The first release succeeds; the nested release should fail.
  await attackerContract.attack();

  expect((await escrow.deals(0)).status).to.equal(2n);
  expect(await attackerContract.attempts()).to.equal(1n);
  expect(await attackerContract.reentryAttemptFailed()).to.equal(true);

  expect(
    await ethers.provider.getBalance(await escrow.getAddress())
  ).to.equal(0n);

  expect(
    await ethers.provider.getBalance(attackerAddress)
  ).to.equal(100n);
});

describe("Arbitrator resolution", function () {
  it("allows the designated arbitrator to refund the buyer", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.connect(arbitrator).deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(
      await seller.getAddress(),
      100n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    const buyerBalanceBefore =
      await ethers.provider.getBalance(await buyer.getAddress());

    await escrow.connect(arbitrator).resolveDispute(0, false);

    const buyerBalanceAfter =
      await ethers.provider.getBalance(await buyer.getAddress());

    expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(100n);
    expect((await escrow.deals(0)).status).to.equal(3n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });

  it("preserves escrow funds when a buyer rejects an arbitrated refund", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, seller] = await ethers.getSigners();

    const RejectEther = await ethers.getContractFactory("RejectEther");
    const rejectingBuyer = await RejectEther.deploy();
    await rejectingBuyer.waitForDeployment();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.connect(arbitrator).deploy();
    await escrow.waitForDeployment();

    const escrowAddress = await escrow.getAddress();
    const buyerAddress = await rejectingBuyer.getAddress();

    await rejectingBuyer.createEscrow(escrowAddress, seller.address, 100n);
    await rejectingBuyer.fundEscrow(escrowAddress, 0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await rejectingBuyer.raiseDispute(escrowAddress, 0);

    await expect(
      escrow.connect(arbitrator).resolveDispute(0, false)
    ).to.be.revertedWith("Settlement failed");

    const deal = await escrow.deals(0);
    expect(deal.status).to.equal(5n); // Disputed
    expect(deal.buyerResolutionVoted).to.equal(false);
    expect(deal.sellerResolutionVoted).to.equal(false);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(100n);
    expect(await ethers.provider.getBalance(buyerAddress)).to.equal(0n);
  });

  it("rejects dispute resolution from an unauthorized account", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller, outsider] =
      await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.connect(arbitrator).deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(
      await seller.getAddress(),
      100n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await expect(
      escrow.connect(outsider).resolveDispute(0, true)
    ).to.be.revertedWith("Only arbitrator");

    expect((await escrow.deals(0)).status).to.equal(5n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(100n);
  });

  it("allows the arbitrator to release funds to the seller", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.connect(arbitrator).deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(
      await seller.getAddress(),
      100n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    const sellerBalanceBefore =
      await ethers.provider.getBalance(await seller.getAddress());

    await escrow.connect(arbitrator).resolveDispute(0, true);

    const sellerBalanceAfter =
      await ethers.provider.getBalance(await seller.getAddress());

    expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(100n);
    expect((await escrow.deals(0)).status).to.equal(2n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });

  it("prevents the arbitrator from resolving the same dispute twice", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.connect(arbitrator).deploy();
    await escrow.waitForDeployment();

    await escrow.connect(buyer).createEscrow(
      await seller.getAddress(),
      100n
    );
    await escrow.connect(buyer).fundEscrow(0, { value: 100n });
    await escrow.connect(seller).submitDelivery(0);
    await escrow.connect(buyer).raiseDispute(0);

    await escrow.connect(arbitrator).resolveDispute(0, false);

    await expect(
      escrow.connect(arbitrator).resolveDispute(0, true)
    ).to.be.revertedWith("No active dispute");

    expect((await escrow.deals(0)).status).to.equal(3n);
    expect(
      await ethers.provider.getBalance(await escrow.getAddress())
    ).to.equal(0n);
  });
});
