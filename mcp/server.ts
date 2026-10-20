import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsonRpcProvider, Wallet } from "ethers";
import { z } from "zod";
import { createEscrowMcpServer } from "./createServer.js";
import { Escrow } from "../sdk/index.js";

async function main(): Promise<void> {
  const rpcUrl = process.env.ESCROW_RPC_URL ?? "http://127.0.0.1:8545";
  const chainName = process.env.ESCROW_CHAIN_NAME ?? "hardhat-local";
  const chainId = BigInt(process.env.ESCROW_CHAIN_ID ?? "31337");
  const privateKey = process.env.ESCROW_PRIVATE_KEY;
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  const writesEnabled = process.env.ESCROW_ENABLE_WRITE_TOOLS === "true";
  if (writesEnabled && !privateKey) {
    throw new Error("ESCROW_PRIVATE_KEY is required when transaction tools are enabled.");
  }
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("ESCROW_PRIVATE_KEY must contain a valid EVM private key.");
  }
  if (!contractAddress) {
    throw new Error("ESCROW_CONTRACT_ADDRESS is required.");
  }

  let tokens: Record<string, { address: string; decimals: number }> = {};
  const tokenConfigText = process.env.ESCROW_TOKEN_CONFIG_JSON;
  if (tokenConfigText) {
    const tokenSchema = z.record(
      z.string(),
      z.object({
        address: z.string(),
        decimals: z.number().int().min(0).max(255),
      }),
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(tokenConfigText);
    } catch {
      throw new Error("ESCROW_TOKEN_CONFIG_JSON must be valid JSON.");
    }
    tokens = tokenSchema.parse(parsed);
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId);
  const wallet = privateKey ? new Wallet(privateKey, provider) : undefined;
  const escrow = new Escrow({
    chain: { name: chainName, chainId },
    wallet,
    provider,
    contractAddress,
    tokens,
  });
  const server = createEscrowMcpServer(escrow, {
    writesEnabled,
  });
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  process.stderr.write("Escrow MCP server failed to start; verify configuration and local RPC availability.\n");
  process.exitCode = 1;
});
