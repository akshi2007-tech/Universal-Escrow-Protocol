import { expect } from "chai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { network } from "hardhat";
import { describe, it } from "mocha";
import { createEscrowMcpServer } from "../mcp/createServer.js";
import { Escrow } from "../sdk/index.js";

const REQUIRED_TOOLS = [
  "create_escrow",
  "get_escrow",
  "fund_escrow",
  "release_escrow",
  "refund_escrow",
  "raise_dispute",
  "resolve_dispute",
  "get_transaction",
];

describe("Escrow MCP server", function () {
  it("registers all required tools with validated schemas", async function () {
    const { ethers } = await network.connect();
    const [buyer] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    const escrow = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress: await contract.getAddress(),
    });
    const server = createEscrowMcpServer(escrow, { writesEnabled: true });
    const client = new Client({ name: "escrow-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).to.deep.equal(
      [...REQUIRED_TOOLS].sort(),
    );
    const createTool = result.tools.find((tool) => tool.name === "create_escrow");
    expect(createTool?.inputSchema.required).to.include("seller");
    expect(createTool?.inputSchema.required).to.include("amount");
    expect(createTool?.annotations?.readOnlyHint).to.equal(false);
    expect(
      result.tools.find((tool) => tool.name === "get_escrow")?.annotations?.readOnlyHint,
    ).to.equal(true);

    await client.close();
    await server.close();
  });

  it("executes real local transactions and returns structured state and events", async function () {
    const { ethers } = await network.connect();
    const [arbitrator, buyer, seller] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow", [], arbitrator);
    const contractAddress = await contract.getAddress();
    const escrow = new Escrow({
      chain: "hardhat-local",
      wallet: buyer,
      contractAddress,
    });
    const server = createEscrowMcpServer(escrow, { writesEnabled: true });
    const client = new Client({ name: "escrow-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const latest = await ethers.provider.getBlock("latest");
    const created = await client.callTool({
      name: "create_escrow",
      arguments: {
        seller: seller.address,
        amount: "0.0000000000000001",
        token: "ETH",
        deadline: String(latest!.timestamp + 3600),
      },
    });
    expect(created.isError).to.not.equal(true);
    const createOutput = created.structuredContent as {
      escrowId: string;
      transaction: { hash: string; events: { name: string }[] };
    };
    expect(createOutput.escrowId).to.equal("0");
    expect(createOutput.transaction.events[0]?.name).to.equal("EscrowCreated");

    const funded = await client.callTool({
      name: "fund_escrow",
      arguments: { escrowId: createOutput.escrowId },
    });
    expect(funded.isError).to.not.equal(true);
    const fundOutput = funded.structuredContent as {
      hash: string;
      events: { name: string }[];
    };
    expect(fundOutput.events.some((event) => event.name === "EscrowFunded")).to.equal(true);

    const state = await client.callTool({
      name: "get_escrow",
      arguments: { escrowId: createOutput.escrowId },
    });
    expect((state.structuredContent as { status: string }).status).to.equal("funded");

    const transaction = await client.callTool({
      name: "get_transaction",
      arguments: { transactionHash: fundOutput.hash },
    });
    expect((transaction.structuredContent as { status: string }).status).to.equal("confirmed");

    await contract.connect(seller).submitDelivery(0);
    const disputed = await client.callTool({
      name: "raise_dispute",
      arguments: { escrowId: "0", reason: "Delivery requires review" },
    });
    expect(disputed.isError).to.not.equal(true);
    const unauthorizedResolution = await client.callTool({
      name: "resolve_dispute",
      arguments: { escrowId: "0", releaseToSeller: true },
    });
    expect(unauthorizedResolution.isError).to.equal(true);
    expect(
      JSON.stringify(unauthorizedResolution),
      JSON.stringify(unauthorizedResolution),
    ).to.contain("Only arbitrator");

    await client.close();
    await server.close();

    const arbitratorSdk = new Escrow({
      chain: "hardhat-local",
      wallet: arbitrator,
      contractAddress,
    });
    const arbitratorServer = createEscrowMcpServer(arbitratorSdk, {
      writesEnabled: true,
    });
    const arbitratorClient = new Client({
      name: "escrow-arbitrator-test-client",
      version: "1.0.0",
    });
    const [arbitratorClientTransport, arbitratorServerTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      arbitratorServer.connect(arbitratorServerTransport),
      arbitratorClient.connect(arbitratorClientTransport),
    ]);
    const resolved = await arbitratorClient.callTool({
      name: "resolve_dispute",
      arguments: { escrowId: "0", releaseToSeller: false },
    });
    expect(resolved.isError).to.not.equal(true);
    expect(await contract.getStatus(0)).to.equal(3n);
    await arbitratorClient.close();
    await arbitratorServer.close();
  });

  it("blocks writes when the server was not explicitly enabled and rejects malformed IDs", async function () {
    const { ethers } = await network.connect();
    const [buyer, seller] = await ethers.getSigners();
    const contract = await ethers.deployContract("Escrow");
    await contract.connect(buyer).createEscrow(seller.address, 100n);
    const escrow = new Escrow({
      chain: "hardhat-local",
      provider: ethers.provider,
      contractAddress: await contract.getAddress(),
    });
    const server = createEscrowMcpServer(escrow);
    const client = new Client({ name: "escrow-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const read = await client.callTool({
      name: "get_escrow",
      arguments: { escrowId: "0" },
    });
    expect((read.structuredContent as { status: string }).status).to.equal("created");

    const disabled = await client.callTool({
      name: "create_escrow",
      arguments: { seller: seller.address, amount: "1" },
    });
    expect(disabled.isError).to.equal(true);
    expect(JSON.stringify(disabled)).to.contain("WRITES_DISABLED");

    const malformed = await client.callTool({
      name: "get_escrow",
      arguments: { escrowId: "-1" },
    });
    expect(malformed.isError).to.equal(true);

    await client.close();
    await server.close();
  });
});
