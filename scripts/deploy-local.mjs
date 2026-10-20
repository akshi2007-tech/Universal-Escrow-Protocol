import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ContractFactory, JsonRpcProvider } from "ethers";

async function main() {
  const rpcUrl = process.env.ESCROW_RPC_URL ?? "http://127.0.0.1:8545";
  const expectedChainId = BigInt(process.env.ESCROW_CHAIN_ID ?? "31337");
  if (expectedChainId !== 31337n) {
    throw new Error("This script only deploys to the local Hardhat chain (31337).");
  }
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Connected to chain ${network.chainId}; expected ${expectedChainId}.`,
    );
  }
  const signer = await provider.getSigner();
  const escrowArtifact = JSON.parse(
    await readFile(
      resolve("artifacts/contracts/Escrow.sol/Escrow.json"),
      "utf8",
    ),
  );
  const tokenArtifact = JSON.parse(
    await readFile(
      resolve("artifacts/contracts/MockERC20.sol/MockERC20.json"),
      "utf8",
    ),
  );

  const escrowFactory = new ContractFactory(
    escrowArtifact.abi,
    escrowArtifact.bytecode,
    signer,
  );
  const escrow = await escrowFactory.deploy();
  await escrow.waitForDeployment();

  const tokenFactory = new ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.bytecode,
    signer,
  );
  const token = await tokenFactory.deploy();
  await token.waitForDeployment();
  const allowToken = await escrow
    .getFunction("setSupportedToken")
    .send(await token.getAddress(), true);
  await allowToken.wait();

  const metadata = {
    schemaVersion: 1,
    chain: { name: "hardhat-local", chainId: network.chainId.toString() },
    contracts: {
      Escrow: {
        address: await escrow.getAddress(),
        abi: escrowArtifact.abi,
      },
    },
    tokens: {
      mUSDC: {
        address: await token.getAddress(),
        decimals: 6,
        symbol: "mUSDC",
      },
    },
  };
  await mkdir(resolve("deployments"), { recursive: true });
  await writeFile(
    resolve("deployments/local.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { encoding: "utf8", flag: "w" },
  );

  console.log(`Escrow: ${metadata.contracts.Escrow.address}`);
  console.log(`mUSDC test token: ${metadata.tokens.mUSDC.address}`);
  console.log("Deployment metadata written to deployments/local.json");
}

main().catch(() => {
  console.error("Local deployment failed. Verify the RPC, chain ID, and development key.");
  process.exitCode = 1;
});
