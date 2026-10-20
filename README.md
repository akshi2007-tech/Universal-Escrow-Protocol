# Universal Escrow Protocol

A reusable EVM escrow contract with a TypeScript/ethers SDK, an MCP server, a
local deployment workflow, and two runnable marketplace reference flows.
Nothing in this repository has been deployed to a public network or audited.

## Architecture

- `contracts/Escrow.sol` — native ETH and ERC-20 escrow state machine,
  approvals, explicit multi-party thresholds, milestones, cancellation,
  expiry refunds, dispute resolution, and signed-agreement verification.
- `sdk/` — typed ethers v6 client, token amount conversion and allowance
  handling, transaction confirmation, state queries, and event decoding.
- `mcp/` — MCP tools backed by that same SDK. Read tools work without a signer;
  write tools are disabled by default.
- `scripts/deploy-local.mjs` — deploys the escrow and a six-decimal mock token
  to a running local Hardhat node and writes local metadata.
- `apps/freelance/` and `apps/p2p/` — CLI reference applications which use the
  SDK against real contracts on an isolated local Hardhat chain.
- `web/` — one Vite documentation website with `/examples/freelance-escrow`
  and `/examples/p2p-escrow` browser integrations. Both use the SDK with an
  injected wallet and the configured local contract; neither simulates chain
  state.
- `test/` — existing regression tests and contract, SDK, and MCP integration
  tests.
- `docs/architecture.md` and `docs/security.md` — architecture and threat
  model notes.

## Requirements

- Node.js version supported by Hardhat 3 and npm.
- For a persistent local demo: two VS Code terminals.
- No external RPC provider, public-chain account, or real funds are needed for
  local development.

Install dependencies and validate the project:

```powershell
npm install
npm run build
npm test
npm run typecheck
```

The build compiles Solidity, emits SDK/MCP JavaScript and declarations, and
builds the docs website. Root TypeScript compilation explicitly excludes
`dist/` so generated declarations are not rediscovered as source inputs.
The current contract/SDK/MCP/reference-flow suite has 62 passing tests.
The current verified local chain is Hardhat (`31337`). The existing Sepolia
network entry is a configuration template only: no contract deployment or
token has been verified there. Base and other networks are intentionally not
listed as supported deployments. No real USDC address is assumed; symbols such
as `USDC` must be explicitly configured for the relevant chain.

## Local persistent deployment and MCP

In terminal 1, start a local node:

```powershell
npx hardhat node --network hardhatMainnet
```

In terminal 2, build and deploy to that node using its unlocked local
development account:

```powershell
npm run deploy:local
$deployment = Get-Content .\deployments\local.json -Raw | ConvertFrom-Json
$env:ESCROW_CONTRACT_ADDRESS = $deployment.contracts.Escrow.address
$env:ESCROW_TOKEN_CONFIG_JSON = '{"mUSDC":{"address":"' + $deployment.tokens.mUSDC.address + '","decimals":6}}'
$env:ESCROW_RPC_URL = "http://127.0.0.1:8545"
$env:ESCROW_CHAIN_NAME = "hardhat-local"
$env:ESCROW_CHAIN_ID = "31337"
```

The local node is ephemeral. After stopping and restarting it, run
`npm run deploy:local` again and reload the metadata; addresses from a prior
node lifetime are stale even if they remain in `deployments/local.json`.

## Interactive documentation and browser references

Keep the local Hardhat node running, deploy to it, then configure the public
browser addresses from the newly generated metadata. This PowerShell snippet
updates only these two Vite entries and preserves unrelated `.env.local`
settings:

```powershell
$deployment = Get-Content .\deployments\local.json -Raw | ConvertFrom-Json
$envPath = ".\.env.local"
$existing = if (Test-Path $envPath) { @(Get-Content $envPath) } else { @() }
$settings = [ordered]@{
  VITE_ESCROW_CONTRACT_ADDRESS = $deployment.contracts.Escrow.address
  VITE_MUSDC_ADDRESS = $deployment.tokens.mUSDC.address
}
$lines = [System.Collections.Generic.List[string]]::new()
$written = @{}
foreach ($line in $existing) {
  if ($line -match '^\s*(VITE_ESCROW_CONTRACT_ADDRESS|VITE_MUSDC_ADDRESS)\s*=') {
    $name = $Matches[1]
    if (-not $written.ContainsKey($name)) {
      $lines.Add("$name=$($settings[$name])")
      $written[$name] = $true
    }
  } else {
    $lines.Add($line)
  }
}
foreach ($name in $settings.Keys) {
  if (-not $written.ContainsKey($name)) {
    $lines.Add("$name=$($settings[$name])")
  }
}
Set-Content -Path $envPath -Value $lines
npm run dev:docs
```

Open the Vite URL (normally `http://127.0.0.1:5173/`). The documentation
explains the actual contract lifecycle and SDK/MCP APIs. The examples are
available at:

- `http://127.0.0.1:5173/examples/freelance-escrow`
- `http://127.0.0.1:5173/examples/p2p-escrow`

Configure an injected browser wallet to the local Hardhat network (RPC
`http://127.0.0.1:8545`, chain ID `31337`). The reference pages can offer to
add/switch to this network. Import a **local development account** from the
Hardhat node output into a development wallet; use different local accounts
for buyer and seller and switch accounts to complete each party's step. Never
use a real wallet key or import a real-funds account into this local demo.
Use ETH for the simplest end-to-end path: `mUSDC` is a mock token and needs a
token balance before funding. Browser transaction details and hashes are real
SDK results; local activity labels and project/deal notes are saved only in
that browser and are not written into the contract. Contract reads use the
configured local RPC independently of the selected wallet network. A wallet on
Sepolia remains on Sepolia until you explicitly choose the switch-network
action; signing is disabled until it is on chain `31337`.

To preview the production build locally, run `npm run build` followed by
`npm run preview:docs`. Vite's SPA fallback serves the example routes directly,
including on refresh.

The generated `deployments/local.json` contains actual addresses returned by
the local deployment and is ignored by Git. To run the MCP server read-only:

```powershell
$env:ESCROW_ENABLE_WRITE_TOOLS = "false"
npm run mcp
```

For MCP transaction tools, set `ESCROW_PRIVATE_KEY` to a **local development
key only** and explicitly enable writes:

```powershell
$env:ESCROW_PRIVATE_KEY = "<local-hardhat-development-key>"
$env:ESCROW_ENABLE_WRITE_TOOLS = "true"
npm run mcp
```

The key is read from the process environment, never printed by the server, and
must not be a real wallet key. MCP write tools are marked as consequential and
the contract still enforces each caller's permissions. Enabling write tools
allows the configured signer to send transactions when a write tool is
invoked; it is not a per-transaction human approval prompt. `get_escrow` and
`get_transaction` are read-only. Token symbols for MCP must be listed in
`ESCROW_TOKEN_CONFIG_JSON` as a JSON object with each token's address and
decimals. A minimal VS Code MCP configuration can use:

```json
{
  "servers": {
    "universal-escrow": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\universal-escrow-protocol\\dist\\mcp\\server.js"],
      "env": {
        "ESCROW_RPC_URL": "http://127.0.0.1:8545",
        "ESCROW_CHAIN_NAME": "hardhat-local",
        "ESCROW_CHAIN_ID": "31337",
        "ESCROW_CONTRACT_ADDRESS": "<address-from-deployments-local-json>",
        "ESCROW_ENABLE_WRITE_TOOLS": "false"
      }
    }
  }
}
```

Do not put a private key in a checked-in MCP configuration. Configure it only
in a protected local environment when write access is intended.

## SDK

The workspace package name is `universal-escrow-protocol`; it is prepared for
local packaging but has **not** been published. Change `name` in
`package.json` to the desired registry name before publishing. The published
SDK entry point is the root export.

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { readFile } from "node:fs/promises";
import { Escrow } from "universal-escrow-protocol";

const provider = new JsonRpcProvider("http://127.0.0.1:8545", 31337);
const wallet = new Wallet(process.env.ESCROW_PRIVATE_KEY!, provider);
const deployment = JSON.parse(
  await readFile("./deployments/local.json", "utf8"),
);
const seller = process.env.SELLER_ADDRESS;
if (!seller) throw new Error("Set SELLER_ADDRESS to the seller's EVM address.");
const escrow = new Escrow({
  chain: "hardhat-local",
  wallet,
  contractAddress: deployment.contracts.Escrow.address,
  tokens: {
    mUSDC: {
      address: deployment.tokens.mUSDC.address,
      decimals: deployment.tokens.mUSDC.decimals,
    },
  },
});

const created = await escrow.createEscrow({
  seller,
  token: "mUSDC",
  amount: "100",
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});
await escrow.deposit(created.id); // checks allowance and approves when needed
const state = await escrow.getEscrow(created.id);
console.log(state.status, created.hash);
```

`Escrow` also exposes `release`, `refund`, `cancel`, `dispute` (with a reason),
`resolve`, `getStatus`, `getTransaction`, EIP-712 `signAgreement` and
`createSignedEscrow`, and milestone/multi-party methods.
`release` submits the connected participant's approval; for a default
two-party deal the other party must also approve, unless the review period
expires without a dispute. Contract reverts and invalid inputs are surfaced as
typed `EscrowSdkError`s. `npm pack --dry-run` can be used to inspect the package
contents; no registry publication is part of this project.

## Lifecycle and asset policy

- The creator is the buyer/funder; the seller is the recipient. Only the
  buyer can fund. The arbitrator is the deployer and is immutable; only the
  arbitrator can allowlist ERC-20 contracts for new agreements.
- The original two-party API requires buyer and seller release approval; a
  public timeout release is available after the review period.
- `createMultiPartyEscrow` requires a distinct approver list containing both
  buyer and seller and an explicit threshold. That threshold governs release
  and party-consensus dispute votes. Multi-party escrows do **not** inherit the
  two-party timeout release; a dispute can be raised after review and the
  configured arbitrator can resolve it.
- The agreement deadline is the last permitted funding time. A funded escrow
  which remains undelivered after that deadline can be refunded to the buyer.
  A zero deadline means no expiry/refund deadline is configured. The buyer can
  cancel only before funding.
- Milestones are sequential, positive amounts whose sum is the escrow total.
  The seller submits the next milestone; the buyer approves it or anyone can
  release it after its three-day review period. A dispute freezes the
  remaining balance; arbitration settles that balance.
- ERC-20 deposits require allowance and exact balance deltas. Fee-on-transfer
  behavior is rejected on funding and payout. The escrow contract rejects
  unallowlisted tokens. Native ETH is supported.
- NFT and other digital assets are not supported.
- Signed agreements use an EIP-712 domain bound to chain ID and contract
  address, both parties' signatures, and a buyer nonce to prevent replay.

## Demos, tests, and testnet procedure

The reference applications execute real SDK-backed transactions on a fresh,
isolated Hardhat chain:

```powershell
npm run demo:freelance
npm run demo:p2p
```

The freelance demo releases two sequential ETH milestones after buyer
approval. The P2P demo uses the local mock token and demonstrates both an
outsider's rejected release approval and a successful buyer/seller release;
it also runs the reasoned-dispute/arbitrator-refund flow.

For architecture and trust boundaries, see [docs/architecture.md](./docs/architecture.md)
and [docs/security.md](./docs/security.md). These engineering notes are not a
professional audit or a production-readiness claim.

To run on Sepolia later, first set `SEPOLIA_RPC_URL` and
`SEPOLIA_PRIVATE_KEY` using the Hardhat keystore (the project does not deploy
automatically):

```powershell
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat ignition deploy ignition/modules/Escrow.ts --network sepolia
```

Only use a funded **testnet** account after reviewing the deployment. Record
the resulting contract/token addresses in a chain-specific SDK configuration
and add network-specific tests before calling that network verified. Do not
deploy to mainnet or use real funds as part of this task.

## Security and limitations

The contract uses checks-effects-interactions, a reentrancy guard on token
funding and settlement, exact-value token checks, and state rollback on failed
transfers. The automated suite is not a professional audit. Slither is not
installed in the current environment, and static analysis remains outstanding.
There is no verified public deployment, production token configuration, or
mainnet support. The provided workspace has no Git metadata, so a Git diff
could not be inspected.
