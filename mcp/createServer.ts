import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAddress } from "ethers";
import { z } from "zod";
import {
  Escrow,
  EscrowSdkError,
  type DecodedEvent,
  type EscrowDetails,
  type TransactionDetails,
  type TransactionResult,
} from "../sdk/index.js";

const escrowIdSchema = z.string().regex(/^(0|[1-9]\d*)$/, "Use a non-negative decimal escrow ID.");
const addressSchema = z.string().refine(isAddress, "Must be a valid EVM address.");
const amountSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Use a decimal amount string.");
const deadlineSchema = z.string().regex(/^\d+$/, "Use a Unix timestamp in seconds.");
const transactionEventSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
const transactionOutputSchema = z.object({
  hash: z.string(),
  status: z.literal("confirmed"),
  blockNumber: z.number(),
  events: z.array(transactionEventSchema),
});
const escrowOutputSchema = z.object({
  id: z.string(),
  buyer: z.string(),
  seller: z.string(),
  amount: z.string(),
  remainingAmount: z.string(),
  token: z.string(),
  status: z.string(),
  deadline: z.string(),
  reviewDeadline: z.string(),
  approvalThreshold: z.string(),
  approvalCount: z.string(),
  milestoneCount: z.string(),
  milestoneMode: z.boolean(),
  multiParty: z.boolean(),
});
const transactionDetailsSchema = z.object({
  hash: z.string(),
  status: z.enum(["pending", "confirmed", "failed"]),
  blockNumber: z.number().nullable(),
  events: z.array(transactionEventSchema),
});

export interface EscrowMcpOptions {
  writesEnabled?: boolean;
}

function serializableEvent(event: DecodedEvent): {
  name: string;
  args: Record<string, unknown>;
} {
  return {
    name: event.name,
    args: Object.fromEntries(
      Object.entries(event.args).map(([key, value]) => [
        key,
        typeof value === "bigint" ? value.toString() : value,
      ]),
    ),
  };
}

function serializableTransaction(transaction: TransactionResult) {
  return {
    hash: transaction.hash,
    status: transaction.status,
    blockNumber: transaction.receipt.blockNumber,
    events: transaction.events.map(serializableEvent),
  };
}

function serializableEscrow(escrow: EscrowDetails) {
  return {
    id: escrow.id.toString(),
    buyer: escrow.buyer,
    seller: escrow.seller,
    amount: escrow.amount.toString(),
    remainingAmount: escrow.remainingAmount.toString(),
    token: escrow.token,
    status: escrow.status,
    deadline: escrow.deadline.toString(),
    reviewDeadline: escrow.reviewDeadline.toString(),
    approvalThreshold: escrow.approvalThreshold.toString(),
    approvalCount: escrow.approvalCount.toString(),
    milestoneCount: escrow.milestoneCount.toString(),
    milestoneMode: escrow.milestoneMode,
    multiParty: escrow.multiParty,
  };
}

function serializableTransactionDetails(transaction: TransactionDetails) {
  return {
    ...transaction,
    events: transaction.events.map(serializableEvent),
  };
}

function errorResult(error: unknown) {
  const code =
    error instanceof EscrowSdkError ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof EscrowSdkError
      ? error.message
      : "The escrow tool failed. Check server configuration and contract availability.";
  const data = { error: { code, message } };
  return {
    isError: true,
    structuredContent: data,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function successResult(data: Record<string, unknown>) {
  return {
    structuredContent: data,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function createEscrowMcpServer(
  escrow: Escrow,
  options: EscrowMcpOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "universal-escrow", version: "1.0.0" },
    { maxToolInputElements: 64 },
  );
  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const guardWrite = () => {
    if (!options.writesEnabled) {
      throw new EscrowSdkError(
        "WRITES_DISABLED",
        "Transaction tools are disabled. Set ESCROW_ENABLE_WRITE_TOOLS=true after reviewing the signer and network.",
      );
    }
  };

  server.registerTool(
    "create_escrow",
    {
      description: "Create a two-party escrow agreement. Sends a transaction.",
      inputSchema: z.object({
        seller: addressSchema,
        amount: amountSchema,
        token: z.string().optional(),
        deadline: deadlineSchema.optional(),
      }),
      outputSchema: z.object({
        escrowId: z.string(),
        transaction: transactionOutputSchema,
      }),
      annotations: writeAnnotations,
    },
    async ({ seller, amount, token, deadline }) => {
      try {
        guardWrite();
        const created = await escrow.createEscrow({
          seller,
          amount,
          token,
          deadline: deadline === undefined ? undefined : BigInt(deadline),
        });
        return successResult({
          escrowId: created.id.toString(),
          transaction: serializableTransaction(created),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_escrow",
    {
      description: "Read an escrow and its lifecycle status without sending a transaction.",
      inputSchema: z.object({ escrowId: escrowIdSchema }),
      outputSchema: escrowOutputSchema,
      annotations: readAnnotations,
    },
    async ({ escrowId }) => {
      try {
        return successResult(serializableEscrow(await escrow.getEscrow(escrowId)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fund_escrow",
    {
      description: "Approve an ERC-20 allowance when needed and fund an escrow. Sends transaction(s).",
      inputSchema: z.object({ escrowId: escrowIdSchema }),
      outputSchema: transactionOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ escrowId }) => {
      try {
        guardWrite();
        return successResult(serializableTransaction(await escrow.deposit(escrowId)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "release_escrow",
    {
      description: "Submit the connected participant's release approval. Sends a transaction.",
      inputSchema: z.object({ escrowId: escrowIdSchema }),
      outputSchema: transactionOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ escrowId }) => {
      try {
        guardWrite();
        return successResult(serializableTransaction(await escrow.release(escrowId)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "refund_escrow",
    {
      description: "Refund an expired, undelivered escrow to its buyer. Sends a transaction.",
      inputSchema: z.object({ escrowId: escrowIdSchema }),
      outputSchema: transactionOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ escrowId }) => {
      try {
        guardWrite();
        return successResult(serializableTransaction(await escrow.refund(escrowId)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "raise_dispute",
    {
      description: "Raise a dispute with a reason while the escrow is awaiting review. Sends a transaction.",
      inputSchema: z.object({
        escrowId: escrowIdSchema,
        reason: z.string().trim().min(1).max(1024),
      }),
      outputSchema: transactionOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ escrowId, reason }) => {
      try {
        guardWrite();
        return successResult(
          serializableTransaction(await escrow.dispute(escrowId, reason)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "resolve_dispute",
    {
      description: "Resolve a dispute as the configured arbitrator. Contract authorization is enforced.",
      inputSchema: z.object({
        escrowId: escrowIdSchema,
        releaseToSeller: z.boolean(),
      }),
      outputSchema: transactionOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ escrowId, releaseToSeller }) => {
      try {
        guardWrite();
        return successResult(
          serializableTransaction(await escrow.resolve(escrowId, releaseToSeller)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Read a transaction, confirmation status, and escrow events without sending a transaction.",
      inputSchema: z.object({
        transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      }),
      outputSchema: transactionDetailsSchema,
      annotations: readAnnotations,
    },
    async ({ transactionHash }) => {
      try {
        return successResult(
          serializableTransactionDetails(await escrow.getTransaction(transactionHash)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
