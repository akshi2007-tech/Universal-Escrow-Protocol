import {
  Contract,
  Interface,
  ZeroAddress,
  getAddress,
  isAddress,
  parseUnits,
  type InterfaceAbi,
  type Provider,
  type Signer,
  type TransactionReceipt,
  type TransactionResponse,
} from "ethers";

export const ESCROW_ABI = [
  "function arbitrator() view returns (address)",
  "function createEscrowWithTerms(address seller,uint256 amount,address token,uint256 deadline,uint256 approvalThreshold) returns (uint256 dealId)",
  "function createMultiPartyEscrow(address seller,uint256 amount,address token,uint256 deadline,address[] approvers,uint256 approvalThreshold) returns (uint256 dealId)",
  "function createMilestoneEscrow(address seller,address token,uint256 deadline,uint256[] milestoneAmounts) returns (uint256 dealId)",
  "function createSignedEscrow(address buyer,address seller,uint256 amount,address token,uint256 deadline,uint256 nonce,bytes buyerSignature,bytes sellerSignature) returns (uint256 dealId)",
  "function agreementNonces(address buyer) view returns (uint256)",
  "function supportedTokens(address token) view returns (bool)",
  "function fundEscrow(uint256 dealId) payable",
  "function submitDelivery(uint256 dealId)",
  "function approveRelease(uint256 dealId)",
  "function releaseAfterTimeout(uint256 dealId)",
  "function refundEscrow(uint256 dealId)",
  "function cancelEscrow(uint256 dealId)",
  "function raiseDispute(uint256 dealId)",
  "function raiseDisputeWithReason(uint256 dealId,string reason)",
  "function resolveDispute(uint256 dealId,bool releaseToSeller)",
  "function submitMilestone(uint256 dealId)",
  "function approveMilestone(uint256 dealId)",
  "function releaseMilestoneAfterTimeout(uint256 dealId)",
  "function getStatus(uint256 dealId) view returns (uint8)",
  "function milestoneAmount(uint256 dealId,uint256 milestone) view returns (uint256)",
  "function milestoneDelivered(uint256 dealId,uint256 milestone) view returns (bool)",
  "function nextMilestoneToDeliver(uint256 dealId) view returns (uint256)",
  "function deals(uint256 dealId) view returns (address buyer,address seller,uint256 amount,uint8 status,bool buyerApproved,bool sellerApproved,uint256 reviewDeadline,bool extensionUsed,bool buyerResolutionVoted,bool sellerResolutionVoted,bool proposedReleaseToSeller,address token,uint256 deadline,uint256 remainingAmount,uint256 approvalThreshold,uint256 approvalCount,uint256 milestoneCount,bool milestoneMode,bool multiParty)",
  "event EscrowCreated(uint256 indexed dealId,address indexed buyer,address indexed seller,uint256 amount)",
  "event EscrowFunded(uint256 indexed dealId,uint256 amount)",
  "event EscrowReleased(uint256 indexed dealId,address seller,uint256 amount)",
  "event EscrowRefunded(uint256 indexed dealId,address buyer,uint256 amount)",
  "event EscrowCancelled(uint256 indexed dealId)",
  "event DeliverySubmitted(uint256 indexed dealId,uint256 reviewDeadline)",
  "event MilestonePaid(uint256 indexed dealId,uint256 indexed milestone,address recipient,uint256 amount)",
  "event DisputeRaised(uint256 indexed dealId)",
  "event DisputeReasonSubmitted(uint256 indexed dealId,address indexed initiator,string reason)",
  "event DisputeResolved(uint256 indexed dealId,bool releasedToSeller)",
] as const satisfies InterfaceAbi;

const TOKEN_ABI = [
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
] as const satisfies InterfaceAbi;

export const LOCAL_CHAIN = {
  name: "hardhat-local",
  chainId: 31337n,
} as const;

export type EscrowStatus =
  | "created"
  | "funded"
  | "released"
  | "refunded"
  | "delivered"
  | "disputed"
  | "cancelled";

const STATUS_NAMES: readonly EscrowStatus[] = [
  "created",
  "funded",
  "released",
  "refunded",
  "delivered",
  "disputed",
  "cancelled",
];
const UINT256_MAX = (1n << 256n) - 1n;

export interface TokenConfiguration {
  address: string;
  decimals: number;
}

export interface EscrowConfiguration {
  chain: string | { name: string; chainId: bigint };
  wallet?: Signer;
  provider?: Provider;
  contractAddress: string;
  tokens?: Record<string, TokenConfiguration>;
}

export interface TransactionResult {
  hash: string;
  status: "confirmed";
  receipt: TransactionReceipt;
  events: DecodedEvent[];
}

export interface CreatedEscrowResult extends TransactionResult {
  id: bigint;
}

export interface DecodedEvent {
  name: string;
  args: Record<string, unknown>;
}

export interface EscrowDetails {
  id: bigint;
  buyer: string;
  seller: string;
  amount: bigint;
  remainingAmount: bigint;
  token: string;
  status: EscrowStatus;
  deadline: bigint;
  reviewDeadline: bigint;
  approvalThreshold: bigint;
  approvalCount: bigint;
  milestoneCount: bigint;
  milestoneMode: boolean;
  multiParty: boolean;
}

export interface MilestoneProgress {
  completed: number;
  total: number;
  amounts: bigint[];
  delivered: boolean[];
}

export interface TransactionDetails {
  hash: string;
  status: "pending" | "confirmed" | "failed";
  blockNumber: number | null;
  events: DecodedEvent[];
}

export interface CreateEscrowInput {
  seller: string;
  amount: string;
  token?: string;
  deadline?: bigint | number;
  approvalThreshold?: number;
}

export interface CreateMultiPartyEscrowInput extends CreateEscrowInput {
  approvers: string[];
}

export interface CreateMilestoneEscrowInput {
  seller: string;
  token?: string;
  deadline: bigint | number;
  milestoneAmounts: string[];
}

export interface SignAgreementInput extends CreateEscrowInput {
  buyer: string;
  deadline: bigint | number;
}

export interface SignedAgreement {
  buyer: string;
  seller: string;
  amount: bigint;
  token: string;
  deadline: bigint;
  nonce: bigint;
  signature: string;
}

export interface CreateSignedEscrowInput extends CreateEscrowInput {
  buyer: string;
  deadline: bigint | number;
  buyerSignature: string;
  sellerSignature: string;
}

const AGREEMENT_TYPES = {
  Agreement: [
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "token", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

export class EscrowSdkError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EscrowSdkError";
  }
}

export class Escrow {
  private readonly contract: Contract;
  private readonly contractAddress: string;
  private readonly chainName: string;
  private readonly chainId: bigint;
  private readonly wallet?: Signer;
  private readonly provider: Provider;
  private readonly tokenConfiguration: Map<string, TokenConfiguration>;
  private readonly contractInterface = new Interface(ESCROW_ABI);

  constructor(configuration: EscrowConfiguration) {
    this.chainName =
      typeof configuration.chain === "string"
        ? configuration.chain
        : configuration.chain.name;
    if (this.chainName !== "hardhat-local" && typeof configuration.chain === "string") {
      throw new EscrowSdkError(
        "UNSUPPORTED_CHAIN",
        `Chain "${this.chainName}" has no verified contract deployment configuration.`,
      );
    }
    this.chainId =
      typeof configuration.chain === "string"
        ? LOCAL_CHAIN.chainId
        : configuration.chain.chainId;
    if (this.chainId <= 0n) {
      throw new EscrowSdkError("INVALID_CHAIN", "Chain ID must be a positive integer.");
    }
    const provider = configuration.wallet?.provider ?? configuration.provider;
    if (!provider) {
      throw new EscrowSdkError(
        "PROVIDER_REQUIRED",
        "Provide a blockchain provider or a wallet connected to one.",
      );
    }
    this.provider = provider;
    this.wallet = configuration.wallet;
    if (!isAddress(configuration.contractAddress)) {
      throw new EscrowSdkError("INVALID_ADDRESS", "Invalid escrow contract address.");
    }
    this.contractAddress = getAddress(configuration.contractAddress);
    this.contract = new Contract(
      this.contractAddress,
      ESCROW_ABI,
      configuration.wallet ?? provider,
    );
    this.tokenConfiguration = new Map();
    for (const [symbol, token] of Object.entries(configuration.tokens ?? {})) {
      const normalizedSymbol = symbol.trim().toUpperCase();
      if (!normalizedSymbol) {
        throw new EscrowSdkError("INVALID_TOKEN", "Configured token symbols cannot be empty.");
      }
      if (normalizedSymbol === "ETH") {
        throw new EscrowSdkError("INVALID_TOKEN", "ETH is reserved for native currency.");
      }
      if (this.tokenConfiguration.has(normalizedSymbol)) {
        throw new EscrowSdkError(
          "INVALID_TOKEN",
          `Token symbol ${normalizedSymbol} is configured more than once.`,
        );
      }
      if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
        throw new EscrowSdkError(
          "INVALID_TOKEN",
          `Token ${symbol} must configure decimals between 0 and 255.`,
        );
      }
      this.tokenConfiguration.set(normalizedSymbol, {
        address: this.validateAddress(token.address, `token ${symbol}`),
        decimals: token.decimals,
      });
    }
  }

  async createEscrow(input: CreateEscrowInput): Promise<CreatedEscrowResult> {
    const seller = this.validateAddress(input.seller, "seller");
    const token = await this.resolveToken(input.token);
    const amount = this.parseAmount(input.amount, token.decimals);
    const deadline = this.normalizeDeadline(input.deadline);
    const threshold = this.normalizeThreshold(input.approvalThreshold);
    const transaction = await this.send("createEscrowWithTerms", [
      seller,
      amount,
      token.address,
      deadline,
      threshold,
    ]);
    const event = transaction.events.find((item) => item.name === "EscrowCreated");
    if (typeof event?.args.dealId !== "bigint") {
      throw new EscrowSdkError(
        "EVENT_MISSING",
        "The confirmed create transaction did not emit EscrowCreated.",
      );
    }
    return { ...transaction, id: event.args.dealId };
  }

  async createMultiPartyEscrow(
    input: CreateMultiPartyEscrowInput,
  ): Promise<CreatedEscrowResult> {
    const seller = this.validateAddress(input.seller, "seller");
    const approvers = input.approvers.map((address) =>
      this.validateAddress(address, "approver"),
    );
    const token = await this.resolveToken(input.token);
    const amount = this.parseAmount(input.amount, token.decimals);
    const threshold = this.normalizeThreshold(input.approvalThreshold);
    const transaction = await this.send("createMultiPartyEscrow", [
      seller,
      amount,
      token.address,
      this.normalizeDeadline(input.deadline),
      approvers,
      threshold,
    ]);
    const event = transaction.events.find((item) => item.name === "EscrowCreated");
    if (typeof event?.args.dealId !== "bigint") {
      throw new EscrowSdkError(
        "EVENT_MISSING",
        "The confirmed create transaction did not emit EscrowCreated.",
      );
    }
    return { ...transaction, id: event.args.dealId };
  }

  async createMilestoneEscrow(
    input: CreateMilestoneEscrowInput,
  ): Promise<CreatedEscrowResult> {
    const seller = this.validateAddress(input.seller, "seller");
    const token = await this.resolveToken(input.token);
    const milestoneAmounts = input.milestoneAmounts.map((amount) =>
      this.parseAmount(amount, token.decimals),
    );
    const transaction = await this.send("createMilestoneEscrow", [
      seller,
      token.address,
      this.normalizeDeadline(input.deadline),
      milestoneAmounts,
    ]);
    const event = transaction.events.find((item) => item.name === "EscrowCreated");
    if (typeof event?.args.dealId !== "bigint") {
      throw new EscrowSdkError(
        "EVENT_MISSING",
        "The confirmed create transaction did not emit EscrowCreated.",
      );
    }
    return { ...transaction, id: event.args.dealId };
  }

  async getAgreementNonce(buyer: string): Promise<bigint> {
    await this.assertNetwork();
    return (await this.contract
      .getFunction("agreementNonces")
      .staticCall(this.validateAddress(buyer, "buyer"))) as bigint;
  }

  async signAgreement(input: SignAgreementInput): Promise<SignedAgreement> {
    if (!this.wallet) {
      throw new EscrowSdkError(
        "WALLET_REQUIRED",
        "A participant wallet is required to sign the agreement.",
      );
    }
    await this.assertNetwork();
    const buyer = this.validateAddress(input.buyer, "buyer");
    const seller = this.validateAddress(input.seller, "seller");
    const signer = (await this.wallet.getAddress()).toLowerCase();
    if (signer !== buyer.toLowerCase() && signer !== seller.toLowerCase()) {
      throw new EscrowSdkError(
        "UNAUTHORIZED",
        "Only the buyer or seller can sign this agreement.",
      );
    }
    const token = await this.resolveToken(input.token);
    const amount = this.parseAmount(input.amount, token.decimals);
    const deadline = this.normalizeDeadline(input.deadline);
    const latest = await this.provider.getBlock("latest");
    if (!latest || deadline <= BigInt(latest.timestamp)) {
      throw new EscrowSdkError(
        "INVALID_DEADLINE",
        "A signed agreement must expire in the future.",
      );
    }
    const nonce = await this.getAgreementNonce(buyer);
    const network = await this.provider.getNetwork();
    const signature = await this.wallet.signTypedData(
      {
        name: "Universal Escrow",
        version: "1",
        chainId: network.chainId,
        verifyingContract: this.contractAddress,
      },
      AGREEMENT_TYPES,
      { buyer, seller, amount, token: token.address, deadline, nonce },
    );
    return { buyer, seller, amount, token: token.address, deadline, nonce, signature };
  }

  async createSignedEscrow(
    input: CreateSignedEscrowInput,
  ): Promise<CreatedEscrowResult> {
    await this.assertNetwork();
    const buyer = this.validateAddress(input.buyer, "buyer");
    const seller = this.validateAddress(input.seller, "seller");
    const token = await this.resolveToken(input.token);
    const amount = this.parseAmount(input.amount, token.decimals);
    const deadline = this.normalizeDeadline(input.deadline);
    const latest = await this.provider.getBlock("latest");
    if (!latest || deadline <= BigInt(latest.timestamp)) {
      throw new EscrowSdkError(
        "INVALID_DEADLINE",
        "A signed agreement must expire in the future.",
      );
    }
    const nonce = await this.getAgreementNonce(buyer);
    const transaction = await this.send("createSignedEscrow", [
      buyer,
      seller,
      amount,
      token.address,
      deadline,
      nonce,
      input.buyerSignature,
      input.sellerSignature,
    ]);
    const event = transaction.events.find((item) => item.name === "EscrowCreated");
    if (typeof event?.args.dealId !== "bigint") {
      throw new EscrowSdkError(
        "EVENT_MISSING",
        "The confirmed create transaction did not emit EscrowCreated.",
      );
    }
    return { ...transaction, id: event.args.dealId };
  }

  async deposit(escrowId: bigint | number | string): Promise<TransactionResult> {
    await this.assertNetwork();
    const id = this.normalizeId(escrowId);
    const deal = await this.readDeal(id);
    if (deal.token !== ZeroAddress) {
      await this.approveToken(deal.token, deal.amount);
      return this.send("fundEscrow", [id]);
    }
    return this.send("fundEscrow", [id], { value: deal.amount });
  }

  async submitDelivery(escrowId: bigint | number | string): Promise<TransactionResult> {
    return this.send("submitDelivery", [this.normalizeId(escrowId)]);
  }

  async release(escrowId: bigint | number | string): Promise<TransactionResult> {
    return this.send("approveRelease", [this.normalizeId(escrowId)]);
  }

  async releaseAfterTimeout(
    escrowId: bigint | number | string,
  ): Promise<TransactionResult> {
    return this.send("releaseAfterTimeout", [this.normalizeId(escrowId)]);
  }

  async refund(escrowId: bigint | number | string): Promise<TransactionResult> {
    return this.send("refundEscrow", [this.normalizeId(escrowId)]);
  }

  async cancel(escrowId: bigint | number | string): Promise<TransactionResult> {
    return this.send("cancelEscrow", [this.normalizeId(escrowId)]);
  }

  async dispute(
    escrowId: bigint | number | string,
    reason: string,
  ): Promise<TransactionResult> {
    if (reason.trim().length === 0 || new TextEncoder().encode(reason).length > 1024) {
      throw new EscrowSdkError(
        "INVALID_DISPUTE_REASON",
        "Dispute reason must contain 1 to 1024 UTF-8 bytes.",
      );
    }
    return this.send("raiseDisputeWithReason", [this.normalizeId(escrowId), reason]);
  }

  async resolve(
    escrowId: bigint | number | string,
    releaseToSeller: boolean,
  ): Promise<TransactionResult> {
    if (!this.wallet) {
      throw new EscrowSdkError(
        "WALLET_REQUIRED",
        "An arbitrator signer is required to resolve a dispute.",
      );
    }
    await this.assertNetwork();
    const arbitrator = (await this.contract
      .getFunction("arbitrator")
      .staticCall()) as string;
    const signer = await this.wallet.getAddress();
    if (arbitrator.toLowerCase() !== signer.toLowerCase()) {
      throw new EscrowSdkError(
        "UNAUTHORIZED",
        "Only arbitrator can resolve a dispute.",
      );
    }
    return this.send("resolveDispute", [
      this.normalizeId(escrowId),
      releaseToSeller,
    ]);
  }

  async submitMilestone(
    escrowId: bigint | number | string,
  ): Promise<TransactionResult> {
    return this.send("submitMilestone", [this.normalizeId(escrowId)]);
  }

  async approveMilestone(
    escrowId: bigint | number | string,
  ): Promise<TransactionResult> {
    return this.send("approveMilestone", [this.normalizeId(escrowId)]);
  }

  async releaseMilestoneAfterTimeout(
    escrowId: bigint | number | string,
  ): Promise<TransactionResult> {
    return this.send("releaseMilestoneAfterTimeout", [
      this.normalizeId(escrowId),
    ]);
  }

  async getEscrow(escrowId: bigint | number | string): Promise<EscrowDetails> {
    const id = this.normalizeId(escrowId);
    await this.assertNetwork();
    const deal = await this.readDeal(id);
    return { id, ...deal };
  }

  async getStatus(escrowId: bigint | number | string): Promise<EscrowStatus> {
    const id = this.normalizeId(escrowId);
    await this.assertNetwork();
    const status = (await this.contract.getFunction("getStatus").staticCall(id)) as bigint;
    return this.statusName(status);
  }

  async getMilestoneProgress(
    escrowId: bigint | number | string,
  ): Promise<MilestoneProgress> {
    const id = this.normalizeId(escrowId);
    await this.assertNetwork();
    const deal = await this.readDeal(id);
    if (!deal.milestoneMode) {
      throw new EscrowSdkError(
        "NOT_MILESTONE_ESCROW",
        "Milestone progress is only available for milestone escrows.",
      );
    }
    const amounts: bigint[] = [];
    const delivered: boolean[] = [];
    for (let index = 0; index < Number(deal.milestoneCount); index += 1) {
      amounts.push(
        (await this.contract
          .getFunction("milestoneAmount")
          .staticCall(id, index)) as bigint,
      );
      delivered.push(
        (await this.contract
          .getFunction("milestoneDelivered")
          .staticCall(id, index)) as boolean,
      );
    }
    const completed = Number(
      (await this.contract
        .getFunction("nextMilestoneToDeliver")
        .staticCall(id)) as bigint,
    );
    return { completed, total: amounts.length, amounts, delivered };
  }

  async getChainTimestamp(): Promise<bigint> {
    await this.assertNetwork();
    const block = await this.provider.getBlock("latest");
    if (!block) {
      throw new EscrowSdkError(
        "BLOCK_UNAVAILABLE",
        "Could not read the latest block timestamp.",
      );
    }
    return BigInt(block.timestamp);
  }

  async getTransaction(hash: string): Promise<TransactionDetails> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new EscrowSdkError("INVALID_HASH", "Invalid transaction hash.");
    }
    await this.assertNetwork();
    const transaction = await this.provider.getTransaction(hash);
    if (!transaction) {
      throw new EscrowSdkError("TRANSACTION_NOT_FOUND", "Transaction was not found.");
    }
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt) {
      return { hash, status: "pending", blockNumber: null, events: [] };
    }
    return {
      hash,
      status: receipt.status === 1 ? "confirmed" : "failed",
      blockNumber: receipt.blockNumber,
      events: this.decodeEvents(receipt.logs),
    };
  }

  private async readDeal(id: bigint): Promise<Omit<EscrowDetails, "id">> {
    const result = (await this.contract.getFunction("deals").staticCall(id)) as {
      buyer: string;
      seller: string;
      amount: bigint;
      status: bigint;
      reviewDeadline: bigint;
      token: string;
      deadline: bigint;
      remainingAmount: bigint;
      approvalThreshold: bigint;
      approvalCount: bigint;
      milestoneCount: bigint;
      milestoneMode: boolean;
      multiParty: boolean;
    };
    return {
      buyer: result.buyer,
      seller: result.seller,
      amount: result.amount,
      remainingAmount: result.remainingAmount,
      token: result.token,
      status: this.statusName(result.status),
      deadline: result.deadline,
      reviewDeadline: result.reviewDeadline,
      approvalThreshold: result.approvalThreshold,
      approvalCount: result.approvalCount,
      milestoneCount: result.milestoneCount,
      milestoneMode: result.milestoneMode,
      multiParty: result.multiParty,
    };
  }

  private async resolveToken(
    selection: string | undefined,
  ): Promise<{ address: string; decimals: number }> {
    if (!selection || selection.toUpperCase() === "ETH") {
      return { address: ZeroAddress, decimals: 18 };
    }
    const configured = this.tokenConfiguration.get(selection.toUpperCase());
    if (configured) {
      await this.assertSupportedToken(configured.address);
      return configured;
    }
    if (!isAddress(selection)) {
      throw new EscrowSdkError(
        "TOKEN_NOT_CONFIGURED",
        `Token "${selection}" is not configured for ${this.chainName}.`,
      );
    }
    const address = getAddress(selection);
    await this.assertNetwork();
    const token = new Contract(address, TOKEN_ABI, this.contract.runner);
    try {
      const decimals = Number(await token.getFunction("decimals").staticCall());
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new EscrowSdkError("INVALID_TOKEN", "Token reported invalid decimals.");
      }
      await this.assertSupportedToken(address);
      return { address, decimals };
    } catch (error) {
      if (error instanceof EscrowSdkError) throw error;
      throw new EscrowSdkError(
        "INVALID_TOKEN",
        "Could not read decimals from the configured token contract.",
      );
    }
  }

  private async assertSupportedToken(tokenAddress: string): Promise<void> {
    await this.assertNetwork();
    const supported = (await this.contract
      .getFunction("supportedTokens")
      .staticCall(tokenAddress)) as boolean;
    if (!supported) {
      throw new EscrowSdkError(
        "UNSUPPORTED_TOKEN",
        `Token ${tokenAddress} is not allowlisted by this escrow contract.`,
      );
    }
  }

  private async approveToken(tokenAddress: string, amount: bigint): Promise<void> {
    if (!this.wallet) {
      throw new EscrowSdkError(
        "WALLET_REQUIRED",
        "A transaction signer is required to approve ERC-20 tokens.",
      );
    }
    try {
      const token = new Contract(tokenAddress, TOKEN_ABI, this.wallet);
      const signerAddress = await this.wallet.getAddress();
      const allowance = (await token
        .getFunction("allowance")
        .staticCall(signerAddress, this.contractAddress)) as bigint;
      if (allowance >= amount) return;
      if (allowance > 0n) {
        await this.confirm(
          (await token.getFunction("approve").send(
            this.contractAddress,
            0n,
          )) as TransactionResponse,
        );
      }
      await this.confirm(
        (await token.getFunction("approve").send(
          this.contractAddress,
          amount,
        )) as TransactionResponse,
      );
    } catch (error) {
      if (error instanceof EscrowSdkError) throw error;
      const reason = this.extractContractReason(error);
      throw new EscrowSdkError(
        "APPROVAL_FAILED",
        reason
          ? `ERC-20 approval failed: ${reason}`
          : "ERC-20 approval failed. Verify the token, wallet, and allowance.",
      );
    }
  }

  private async send(
    functionName: string,
    args: readonly unknown[],
    overrides?: { value: bigint },
  ): Promise<TransactionResult> {
    if (!this.wallet) {
      throw new EscrowSdkError(
        "WALLET_REQUIRED",
        "A transaction signer is required for this escrow action.",
      );
    }
    await this.assertNetwork();
    try {
      const transaction = (await this.contract
        .getFunction(functionName)
        .send(...args, ...(overrides ? [overrides] : []))) as TransactionResponse;
      return await this.confirm(transaction);
    } catch (error) {
      if (error instanceof EscrowSdkError) throw error;
      const reason = this.extractContractReason(error);
      throw new EscrowSdkError(
        "TRANSACTION_FAILED",
        reason
          ? `Escrow transaction rejected: ${reason}`
          : "Escrow transaction failed. Verify the wallet, network, authorization, and escrow state.",
      );
    }
  }

  private async confirm(transaction: TransactionResponse): Promise<TransactionResult> {
    const receipt = await transaction.wait();
    if (!receipt) {
      throw new EscrowSdkError(
        "CONFIRMATION_MISSING",
        `Transaction ${transaction.hash} was submitted but no receipt was returned.`,
      );
    }
    if (receipt.status !== 1) {
      throw new EscrowSdkError(
        "TRANSACTION_REVERTED",
        `Transaction ${transaction.hash} was mined but reverted.`,
      );
    }
    return {
      hash: transaction.hash,
      status: "confirmed",
      receipt,
      events: this.decodeEvents(receipt.logs),
    };
  }

  private decodeEvents(logs: readonly { address: string; topics: readonly string[]; data: string }[]): DecodedEvent[] {
    const events: DecodedEvent[] = [];
    for (const log of logs) {
      if (log.address.toLowerCase() !== this.contractAddress.toLowerCase()) continue;
      const parsed = this.contractInterface.parseLog(log);
      if (!parsed) continue;
      const args: Record<string, unknown> = {};
      for (let index = 0; index < parsed.fragment.inputs.length; index += 1) {
        const name = parsed.fragment.inputs[index]?.name;
        if (name) args[name] = parsed.args[index];
      }
      events.push({ name: parsed.name, args });
    }
    return events;
  }

  private async assertNetwork(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.chainId) {
      throw new EscrowSdkError(
        "WRONG_NETWORK",
        `Wallet is connected to chain ${network.chainId}; ${this.chainName} requires chain ${this.chainId}.`,
      );
    }
    const code = await this.provider.getCode(this.contractAddress);
    if (code === "0x") {
      throw new EscrowSdkError(
        "CONTRACT_NOT_DEPLOYED",
        `No escrow contract is deployed at ${this.contractAddress} on ${this.chainName}.`,
      );
    }
  }

  private validateAddress(address: string, label: string): string {
    if (!isAddress(address)) {
      throw new EscrowSdkError("INVALID_ADDRESS", `Invalid ${label} address.`);
    }
    return getAddress(address);
  }

  private normalizeDeadline(deadline: bigint | number | undefined): bigint {
    if (deadline === undefined) return 0n;
    if (typeof deadline === "number" && (!Number.isSafeInteger(deadline) || deadline <= 0)) {
      throw new EscrowSdkError("INVALID_DEADLINE", "Deadline must be a positive Unix timestamp.");
    }
    const value = BigInt(deadline);
    if (value < 0n || value > UINT256_MAX) {
      throw new EscrowSdkError("INVALID_DEADLINE", "Deadline is outside the supported range.");
    }
    return value;
  }

  private normalizeThreshold(threshold: number | undefined): bigint {
    const value = threshold ?? 2;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new EscrowSdkError(
        "INVALID_APPROVAL_THRESHOLD",
        "Approval threshold must be a positive safe integer.",
      );
    }
    return BigInt(value);
  }

  private normalizeId(id: bigint | number | string): bigint {
    try {
      const value = BigInt(id);
      if (value < 0n || value > UINT256_MAX) throw new Error();
      return value;
    } catch (error) {
      throw new EscrowSdkError(
        "INVALID_ESCROW_ID",
        "Escrow ID must be a non-negative integer.",
      );
    }
  }

  private parseAmount(amount: string, decimals: number): bigint {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
      throw new EscrowSdkError("INVALID_AMOUNT", "Amount must be a positive decimal string.");
    }
    try {
      const parsed = parseUnits(amount, decimals);
      if (parsed <= 0n) {
        throw new EscrowSdkError("INVALID_AMOUNT", "Amount must be greater than zero.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof EscrowSdkError) throw error;
      throw new EscrowSdkError(
        "INVALID_AMOUNT",
        `Amount has more than ${decimals} decimal places.`,
      );
    }
  }

  private statusName(status: bigint): EscrowStatus {
    const name = STATUS_NAMES[Number(status)];
    if (!name) {
      throw new EscrowSdkError("UNKNOWN_STATUS", `Contract returned unknown status ${status}.`);
    }
    return name;
  }

  private extractContractReason(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const details = error as {
      reason?: unknown;
      shortMessage?: unknown;
      message?: unknown;
      info?: { error?: { message?: unknown } };
    };
    const candidates = [
      details.reason,
      details.shortMessage,
      details.info?.error?.message,
      details.message,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const reasonMatch =
        candidate.match(/reverted with reason string ['"]([^'"]+)['"]/i) ??
        candidate.match(/execution reverted:\s*([^(\r\n]+)/i);
      if (reasonMatch?.[1]) return reasonMatch[1].trim();
    }
    return undefined;
  }
}
