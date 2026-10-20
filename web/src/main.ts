import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  formatUnits,
  isAddress,
  type Eip1193Provider,
  type Signer,
} from "ethers";
import { Escrow, type EscrowDetails, type TransactionResult } from "../../sdk/index.js";
import "./style.css";

interface InjectedWallet {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on(event: "accountsChanged", listener: (accounts: unknown) => void): void;
  on(event: "chainChanged", listener: (chainId: unknown) => void): void;
}

interface SavedTransaction {
  label: string;
  hash: string;
  blockNumber: number;
  events: string[];
}

interface AppMetadata {
  title: string;
  description: string;
  labels: string[];
}

declare global {
  interface Window {
    ethereum?: InjectedWallet;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Documentation root element was not found.");

const chainId = 31337n;
const rpcUrl = import.meta.env.VITE_ESCROW_RPC_URL?.trim() || "http://127.0.0.1:8545";
const contractAddress = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS?.trim() ?? "";
const tokenAddress = import.meta.env.VITE_MUSDC_ADDRESS?.trim() ?? "";
const localProvider = new JsonRpcProvider(rpcUrl, chainId);
const tokenConfiguration: Record<string, { address: string; decimals: number }> =
  tokenAddress && isAddress(tokenAddress)
    ? { mUSDC: { address: tokenAddress, decimals: 6 } }
    : {};

let provider: BrowserProvider | null = null;
let signer: Signer | null = null;
let account: string | null = null;
let connectedChain: bigint | null = null;
let localRpcChain: bigint | null = null;
let contractCodeAvailable: boolean | null = null;
let tokenCodeAvailable: boolean | null = null;
let configurationError = "";
let currentDetails: EscrowDetails | null = null;
let currentProgress: { completed: number; total: number; amounts: bigint[]; delivered: boolean[] } | null = null;
let arbitrator: string | null = null;
let approvedByAccount = false;
let accountIsApprover = false;
let chainTimestamp = 0n;
let busy = false;
let notice = "";
let noticeKind: "info" | "success" | "error" = "info";
let metadataWarning = "";
let loadedEscrowId: string | null = null;

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const shortAddress = (value: string): string =>
  value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;

function codeBlock(source: string): string {
  const highlighted = escapeHtml(source)
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="syntax-string">$1</span>')
    .replace(
      /\b(import|from|const|new|await|async|return|throw|try|catch|if|type|export)\b/g,
      '<span class="syntax-keyword">$1</span>',
    );
  return `<div class="code-wrap"><button class="copy-code" type="button" aria-label="Copy code">Copy</button><pre><code>${highlighted}</code></pre></div>`;
}

function docsNavigation(): string {
  const sections = [
    ["Start here", [["Introduction", "introduction"], ["How escrow works", "lifecycle"], ["Architecture", "architecture"], ["Quick start", "quickstart"]]],
    ["Reference", [["SDK reference", "sdk-reference"], ["Contract reference", "contract-reference"], ["MCP server", "mcp"], ["Security & best practices", "security"]]],
    ["Learn by example", [["Freelance escrow ↗", "/examples/freelance-escrow"], ["P2P escrow ↗", "/examples/p2p-escrow"]]],
  ] as const;
  return sections
    .map(
      ([label, links]) =>
        `<div class="side-label">${label}</div>${links
          .map(([name, href]) =>
            href.startsWith("/")
              ? `<a class="side-link example-link" href="${href}">${name}</a>`
              : `<a class="side-link" href="#${href}">${name}</a>`,
          )
          .join("")}`,
    )
    .join("");
}

function architectureDiagram(): string {
  return `<div class="diagram" role="img" aria-label="Architecture diagram showing the application and MCP client using the TypeScript SDK to read through JSON-RPC and send signed transactions to the escrow contract on the blockchain">
    <svg viewBox="0 0 760 230" aria-hidden="true">
      <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#608c7b"/></marker></defs>
      <rect x="24" y="32" width="150" height="56"/><text x="99" y="56" text-anchor="middle">Application UI</text><text class="tiny" x="99" y="74" text-anchor="middle">Freelance / P2P</text>
      <rect x="24" y="140" width="150" height="56"/><text x="99" y="164" text-anchor="middle">MCP client</text><text class="tiny" x="99" y="182" text-anchor="middle">tool calls</text>
      <rect class="accent" x="240" y="82" width="166" height="64"/><text x="323" y="109" text-anchor="middle">TypeScript SDK</text><text class="tiny" x="323" y="128" text-anchor="middle">ethers · validation · receipts</text>
      <rect x="480" y="32" width="112" height="56"/><text x="536" y="56" text-anchor="middle">Wallet</text><text class="tiny" x="536" y="74" text-anchor="middle">signs writes</text>
      <rect x="480" y="140" width="112" height="56"/><text x="536" y="164" text-anchor="middle">JSON-RPC</text><text class="tiny" x="536" y="182" text-anchor="middle">reads + receipts</text>
      <rect class="accent" x="644" y="82" width="100" height="64"/><text x="694" y="109" text-anchor="middle">EVM</text><text class="tiny" x="694" y="128" text-anchor="middle">Escrow + token</text>
      <path class="arrow" marker-end="url(#arrow)" d="M174 60H224"/><path class="arrow" marker-end="url(#arrow)" d="M174 168Q210 168 240 135"/>
      <path class="arrow" marker-end="url(#arrow)" d="M406 96Q450 60 474 60"/><path class="arrow" marker-end="url(#arrow)" d="M406 132Q450 168 474 168"/>
      <path class="arrow" marker-end="url(#arrow)" d="M592 60Q620 60 638 92"/><path class="arrow" marker-end="url(#arrow)" d="M592 168Q620 168 638 137"/>
      <text class="tiny" x="620" y="46" text-anchor="middle">signed tx</text><text class="tiny" x="620" y="208" text-anchor="middle">state, logs, receipt</text>
    </svg>
  </div>`;
}

function lifecycleDiagram(): string {
  return `<div class="diagram" role="img" aria-label="Escrow lifecycle using contract status values: Created, Funded, Delivered, Disputed, Released, Refunded and Cancelled">
    <svg viewBox="0 0 760 208" aria-hidden="true">
      <defs><marker id="arrow-life" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#608c7b"/></marker></defs>
      <rect class="accent" x="18" y="76" width="104" height="48"/><text x="70" y="105" text-anchor="middle">Created</text>
      <rect x="170" y="76" width="104" height="48"/><text x="222" y="105" text-anchor="middle">Funded</text>
      <rect x="322" y="76" width="104" height="48"/><text x="374" y="105" text-anchor="middle">Delivered</text>
      <rect x="478" y="22" width="104" height="48"/><text x="530" y="51" text-anchor="middle">Disputed</text>
      <rect class="accent" x="634" y="22" width="104" height="48"/><text x="686" y="51" text-anchor="middle">Released</text>
      <rect class="accent" x="478" y="140" width="104" height="48"/><text x="530" y="169" text-anchor="middle">Refunded</text>
      <rect x="18" y="140" width="104" height="48"/><text x="70" y="169" text-anchor="middle">Cancelled</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M122 100H164"/><text class="tiny" x="143" y="91" text-anchor="middle">buyer funds</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M70 124V134"/><text class="tiny" x="105" y="138">buyer cancels</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M222 124Q235 162 472 162"/><text class="tiny" x="350" y="153" text-anchor="middle">expiry refund · undelivered</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M274 100H316"/><text class="tiny" x="295" y="91" text-anchor="middle">seller delivers</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M426 91Q530 5 628 39"/><text class="tiny" x="525" y="19" text-anchor="middle">approvals / timeout</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M426 87Q448 70 472 55"/><text class="tiny" x="445" y="68">party disputes</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M582 46H628"/><text class="tiny" x="605" y="37" text-anchor="middle">arbitrator: seller</text>
      <path class="arrow" marker-end="url(#arrow-life)" d="M530 70V134"/><text class="tiny" x="547" y="108">arbitrator: buyer</text>
    </svg>
  </div>`;
}

const quickStartCode = [
  'import { JsonRpcProvider, Wallet } from "ethers";',
  'import { Escrow } from "universal-escrow-protocol";',
  "",
  'const provider = new JsonRpcProvider("http://127.0.0.1:8545", 31337);',
  "const wallet = new Wallet(process.env.ESCROW_PRIVATE_KEY!, provider);",
  "const escrow = new Escrow({",
  '  chain: { name: "hardhat-local", chainId: 31337n },',
  "  wallet,",
  "  contractAddress: process.env.ESCROW_CONTRACT_ADDRESS!,",
  "});",
  "",
  "const created = await escrow.createEscrow({",
  "  seller: process.env.SELLER_ADDRESS!,",
  '  amount: "0.05",',
  '  token: "ETH",',
  "});",
  "const funded = await escrow.deposit(created.id);",
  "console.log(created.id, created.hash, funded.hash);",
].join("\n");

function renderDocs(): void {
  document.title = "Universal Escrow Protocol — Developer docs";
  document.body.className = "";
  app!.innerHTML = `<header class="topbar">
    <a class="brand" href="/" aria-label="Universal Escrow Protocol documentation home"><span class="brand-mark">U</span><span>Universal Escrow</span></a>
    <nav class="topnav" aria-label="Top navigation"><a href="#sdk-reference">SDK</a><a href="#mcp">MCP server</a><a class="topnav-cta" href="/examples/freelance-escrow">Explore examples</a></nav>
  </header>
  <div class="layout"><aside class="sidebar" aria-label="Documentation navigation">${docsNavigation()}</aside>
  <main class="doc-main"><div class="doc-content">
    <section id="introduction">
      <div class="eyebrow">Developer documentation · v1.0</div>
      <h1>Escrow infrastructure for the apps you build.</h1>
      <p class="lead">Universal Escrow Protocol gives applications an on-chain way to hold ETH or allowlisted ERC-20 payments until agreed delivery, approval, timeout, or dispute conditions are met. Use the typed SDK instead of writing escrow contracts for each product.</p>
      <div class="hero-actions"><a class="button" href="#quickstart">Start building <span aria-hidden="true">→</span></a><a class="button secondary" href="/examples/freelance-escrow">Open live references</a></div>
      <div class="grid-3">
        <article class="card"><span class="card-number">01 / PROTOCOL</span><h3>One escrow state machine</h3><p>Solidity enforces roles, terms, funding, release, refunds, and dispute outcomes. The UI never decides custody rules.</p></article>
        <article class="card"><span class="card-number">02 / SDK</span><h3>Typed integration</h3><p>The ethers v6 SDK validates inputs, handles token allowance, waits for transaction receipts, and decodes contract events.</p></article>
        <article class="card"><span class="card-number">03 / MCP</span><h3>Tools for agents</h3><p>Eight validated MCP tools expose SDK reads and optional writes. Write access is off unless explicitly enabled.</p></article>
      </div>
      <div class="callout warning"><p><strong>Local-first status:</strong> this workspace has a verified Hardhat deployment workflow for chain ID 31337. Sepolia is a configuration template, not a verified deployment. The project has not received a professional security audit.</p></div>
    </section>

    <section class="section" id="lifecycle">
      <div class="eyebrow">01 · Understand the protocol</div><h2>How escrow works</h2>
      <p class="section-intro">An escrow is a single on-chain agreement. The buyer creates it; only the buyer can fund it. After delivery, the configured approval threshold or the supported timeout rules determine settlement.</p>
      ${lifecycleDiagram()}
      <div class="grid-2" style="margin-top:16px">
        <article class="card"><h3>Created → Funded</h3><p>Buyer creates with a positive amount, seller, asset, deadline, and approval threshold. The buyer funds once. ETH must match exactly; ERC-20 funds are pulled after allowance and must transfer the exact amount.</p></article>
        <article class="card"><h3>Funded → Delivered</h3><p>Seller submits delivery. This starts a three-day review period. For milestone deals, the seller submits the next sequential tranche instead.</p></article>
        <article class="card"><h3>Delivered → Released</h3><p>Each configured approver calls <code>approveRelease</code>. For the default two-party deal, buyer and seller must both approve. After the review deadline, anyone can trigger timeout release unless it is multi-party.</p></article>
        <article class="card"><h3>Disputed → Resolved</h3><p>Buyer or seller may dispute during review in two-party deals. The immutable deployer-arbitrator can settle remaining funds to seller or buyer. Party consensus is implemented in Solidity but is not currently exposed as an SDK method.</p></article>
      </div>
      <div class="callout"><p><strong>Refund and cancel differ:</strong> buyer can cancel only before funding. Anyone may trigger a refund only while funded, undelivered, and strictly after a nonzero agreement deadline. A dispute refund is a separate arbitrator settlement.</p></div>
      <h3>Smallest funded workflow</h3>${codeBlock(quickStartCode)}
      <h3>Review, release, refund, and dispute</h3>
      <p>After the seller submits delivery, both configured parties approve a standard two-party release within the review window. Each method is a separate signed transaction; the final required approval transfers the remaining amount.</p>
      ${codeBlock([
        "await sellerEscrow.submitDelivery(escrowId);",
        "await buyerEscrow.release(escrowId);",
        "const settled = await sellerEscrow.release(escrowId);",
        'if (settled.status !== "confirmed") throw new Error("Release was not confirmed");',
      ].join("\n"))}
      <p>A funded deal that is still undelivered after its nonzero agreement deadline may be refunded to the buyer. A buyer may cancel only before funding. For a delivery dispute, a party submits a reason; only the configured arbitrator can settle through the current SDK.</p>
      ${codeBlock([
        'await partyEscrow.dispute(escrowId, "Delivery does not match the agreement.");',
        "await arbitratorEscrow.resolve(escrowId, false); // false refunds the buyer",
      ].join("\n"))}
      <details class="card"><summary><strong>Deeper reference: contract guards</strong></summary><p><code>Escrow.sol</code> stores seven status values: Created, Funded, Released, Refunded, Delivered, Disputed, and Cancelled. Invalid states, unauthorized callers, missed deadlines, duplicate approvals, bad amounts, or unsupported tokens revert. Read the source-level guards in <code>contracts/Escrow.sol</code> and SDK methods in <code>sdk/Escrow.ts</code>.</p></details>
    </section>

    <section class="section" id="architecture">
      <div class="eyebrow">02 · Components and data flow</div><h2>Architecture</h2>
      <p class="section-intro">Reference UIs and the MCP server share the same SDK. Reads go through a JSON-RPC provider. The wallet signs writes; the SDK waits for a receipt and returns decoded events to the application.</p>
      ${architectureDiagram()}
      <div class="grid-2" style="margin-top:16px">
        <article class="card"><h3>Application</h3><p>Collects product-specific project or transaction details and renders protocol state. Application metadata is not stored by this contract.</p></article>
        <article class="card"><h3>SDK and signer</h3><p>SDK calls use the configured provider and optional signer. A wallet prompts for transaction approval; the SDK does not custody keys.</p></article>
        <article class="card"><h3>MCP server</h3><p>Provides a stdio tool interface over the same SDK. Read tools need no signer; writes require explicit configuration and the signer remains subject to contract permissions.</p></article>
        <article class="card"><h3>Contract and chain</h3><p>The contract holds escrowed assets and emits lifecycle events. ERC-20 support requires prior allowlisting by the immutable arbitrator.</p></article>
      </div>
      <h3>Wallet signing in a browser</h3><p>The application obtains a signer from the connected wallet and passes that signer to the SDK. Read-only state still comes from the provider; the key never enters the app's code or configuration.</p>
      ${codeBlock([
        'import { BrowserProvider } from "ethers";',
        'import { Escrow } from "universal-escrow-protocol";',
        "",
        "const provider = new BrowserProvider(window.ethereum);",
        "const signer = await provider.getSigner();",
        "const escrow = new Escrow({",
        '  chain: { name: "hardhat-local", chainId: 31337n },',
        "  provider,",
        "  wallet: signer,",
        "  contractAddress,",
        "});",
      ].join("\n"))}
    </section>

    <section class="section" id="quickstart">
      <div class="eyebrow">03 · Run locally</div><h2>Installation and quick start</h2>
      <p>Use Node.js supported by Hardhat 3 and npm. No public RPC, public account, or real funds are needed for a local development deployment.</p>
      ${codeBlock("npm install\nnpx hardhat node --network hardhatMainnet")}
      <p>In a second terminal, compile and deploy to the running local node. The deployment script uses its unlocked development account and writes ignored local metadata to <code>deployments/local.json</code>.</p>
      ${codeBlock("npm run deploy:local\n$deployment = Get-Content .\\\\deployments\\\\local.json -Raw | ConvertFrom-Json\n$env:ESCROW_CONTRACT_ADDRESS = $deployment.contracts.Escrow.address")}
      <p>Set <code>ESCROW_RPC_URL</code>, <code>ESCROW_CHAIN_NAME=hardhat-local</code>, <code>ESCROW_CHAIN_ID=31337</code>, and the deployed contract address. Configure the mock token only if needed; it is a test token and not USDC.</p>
      <h3>SDK initialization and transaction receipts</h3>${codeBlock(quickStartCode)}
      <div class="callout"><p>For ERC-20 agreements, pass configured token symbol/address and decimals. <code>deposit</code> checks allowance and confirms approval transaction(s) before it funds. The SDK returns only after a successful receipt; a rejected wallet prompt, failed transaction, or missing receipt throws an <code>EscrowSdkError</code>.</p></div>
      <p>For a browser reference, configure public <code>VITE_ESCROW_CONTRACT_ADDRESS</code> and <code>VITE_MUSDC_ADDRESS</code> values from the local deployment, start the docs app, and connect a wallet on chain 31337. Never place a private key in a <code>VITE_</code> variable.</p>
    </section>

    <section class="section" id="sdk-reference">
      <div class="eyebrow">04 · TypeScript API</div><h2>SDK reference</h2>
      <p>The package root exports <code>Escrow</code>, <code>EscrowSdkError</code>, <code>ESCROW_ABI</code>, <code>LOCAL_CHAIN</code>, and the public input/result/status types. The current release is local workspace source; it has not been published to a package registry.</p>
      <div class="table-wrap"><table><thead><tr><th>Method</th><th>Purpose / rules</th><th>Result</th></tr></thead><tbody>
        <tr><td><code>new Escrow(configuration)</code></td><td>Requires provider or wallet, contract address and chain; optional token symbol/address-decimal map.</td><td>Configured SDK client.</td></tr>
        <tr><td><code>createEscrow(input)</code></td><td>Two-party deal. Buyer is the connected signer; inputs include seller, human-readable amount, optional token, deadline, approval threshold.</td><td>Confirmed transaction plus emitted escrow id.</td></tr>
        <tr><td><code>createMultiPartyEscrow(input)</code></td><td>Buyer creates with seller, amount, token, deadline, unique approvers and explicit threshold including buyer and seller.</td><td>Confirmed transaction plus id.</td></tr>
        <tr><td><code>createMilestoneEscrow(input)</code></td><td>Creates positive sequential amount tranches; seller and buyer are default approvers.</td><td>Confirmed transaction plus id.</td></tr>
        <tr><td><code>signAgreement(input)</code> / <code>createSignedEscrow(input)</code></td><td>Participant wallet signs chain/contract-bound EIP-712 terms; creation verifies buyer and seller signatures and consumes the buyer nonce.</td><td><code>SignedAgreement</code> / confirmed transaction plus id.</td></tr>
        <tr><td><code>deposit(id)</code></td><td>Only buyer. Sends exact ETH value or approves ERC-20 and funds.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>submitDelivery(id)</code> / <code>release(id)</code></td><td>Seller submits a standard delivery; configured approvers approve release.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>releaseAfterTimeout(id)</code></td><td>Any caller after the three-day review; disabled for multi-party escrows.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>refund(id)</code> / <code>cancel(id)</code></td><td>Refund only after funded undelivered deadline expiry; buyer cancellation only before funding.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>dispute(id, reason)</code> / <code>resolve(id, releaseToSeller)</code></td><td>Party opens a dispute; only the configured arbitrator can resolve via this SDK.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>submitMilestone(id)</code> / <code>approveMilestone(id)</code></td><td>Seller submits the next tranche; buyer approves during review.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>releaseMilestoneAfterTimeout(id)</code></td><td>Any caller after the milestone review period.</td><td>Confirmed transaction result.</td></tr>
        <tr><td><code>getEscrow(id)</code> / <code>getStatus(id)</code></td><td>Reads stored deal state and current lifecycle status.</td><td>Typed values; never a transaction.</td></tr>
        <tr><td><code>getMilestoneProgress(id)</code></td><td>Reads all tranche amounts, delivery flags, and completed count for milestone escrow.</td><td><code>MilestoneProgress</code>.</td></tr>
        <tr><td><code>getAgreementNonce(buyer)</code> / <code>getChainTimestamp()</code></td><td>Reads signing nonce or latest chain block timestamp.</td><td><code>bigint</code>.</td></tr>
        <tr><td><code>getTransaction(hash)</code></td><td>Reads an existing transaction, receipt status, block number and matching escrow events.</td><td>Pending, confirmed, or failed details.</td></tr>
      </tbody></table></div>
      <p><code>CreateEscrowInput</code> uses <code>seller: string</code> (EVM address), <code>amount: string</code> (human-readable decimal), optional <code>token: string</code>, optional <code>deadline: bigint | number</code> (Unix seconds; zero disables expiry), and optional <code>approvalThreshold: number</code>. Milestone inputs use <code>milestoneAmounts: string[]</code> and an explicit deadline. Escrow IDs accept <code>bigint | number | string</code>.</p>
      <p>A confirmed write returns <code>TransactionResult</code>: <code>hash</code>, <code>status: "confirmed"</code>, the ethers receipt, and decoded escrow events. Create methods extend it with <code>id: bigint</code>. <code>getEscrow</code> returns the participants, amount/remaining amount, token address, status, deadlines, threshold and milestone flags. Read calls need a provider; writes need a signer.</p>
      <h3>Input and error pattern</h3>${codeBlock([
        "try {",
        '  const created = await escrow.createEscrow({ seller, amount: "0.05", token: "ETH" });',
        "  const funded = await escrow.deposit(created.id);",
        "  console.log(created.id, funded.hash, funded.receipt.blockNumber);",
        "} catch (error) {",
        "  if (error instanceof EscrowSdkError) {",
        "    console.error(error.code, error.message);",
        "  } else {",
        "    throw error;",
        "  }",
        "}",
      ].join("\n"))}
      <p>Relevant public types include <code>CreateEscrowInput</code>, <code>CreateMultiPartyEscrowInput</code>, <code>CreateMilestoneEscrowInput</code>, <code>EscrowConfiguration</code>, <code>EscrowDetails</code>, <code>TransactionResult</code>, and <code>TransactionDetails</code>. SDK writes require a signer and verify chain ID/contract code.</p>
    </section>

    <section class="section" id="contract-reference">
      <div class="eyebrow">05 · Source of truth</div><h2>Contract reference</h2>
      <p><code>contracts/Escrow.sol</code> is authoritative for permissions and state transitions. The SDK does not override these checks.</p>
      <div class="table-wrap"><table><thead><tr><th>Function</th><th>Caller / precondition</th><th>Effect</th></tr></thead><tbody>
        <tr><td><code>createEscrowWithTerms</code></td><td>Any buyer; valid seller, positive amount, supported asset, future or zero deadline.</td><td>Creates Created state and release approvers.</td></tr>
        <tr><td><code>fundEscrow</code></td><td>Buyer only; Created; before deadline; exact ETH / exact token transfer.</td><td>Moves to Funded and holds payment.</td></tr>
        <tr><td><code>submitDelivery</code></td><td>Seller only; Funded; non-milestone deal.</td><td>Moves to Delivered and starts a 3-day review period.</td></tr>
        <tr><td><code>approveRelease</code></td><td>Unique configured approver; Delivered and within review window.</td><td>Counts approval and settles when threshold is met.</td></tr>
        <tr><td><code>releaseAfterTimeout</code></td><td>Anyone; Delivered; after review; not multi-party.</td><td>Releases remaining funds to seller.</td></tr>
        <tr><td><code>refundEscrow</code></td><td>Anyone; Funded; deadline is nonzero and has passed.</td><td>Refunds undelivered payment to buyer.</td></tr>
        <tr><td><code>raiseDisputeWithReason</code></td><td>Configured party; Delivered; review active for two-party deal.</td><td>Moves to Disputed and emits reason.</td></tr>
        <tr><td><code>resolveDispute</code></td><td>Immutable deployment arbitrator; Disputed.</td><td>Settles remaining funds to buyer or seller.</td></tr>
        <tr><td><code>createMilestoneEscrow</code> / milestone methods</td><td>Seller submits sequentially; buyer approves in review, or anyone after review.</td><td>Partial payout; remaining amount and next tranche update.</td></tr>
      </tbody></table></div>
      <p>Events include <code>EscrowCreated</code>, <code>EscrowFunded</code>, <code>DeliverySubmitted</code>, <code>ReleaseApproved</code>, <code>EscrowReleased</code>, <code>EscrowRefunded</code>, <code>DisputeRaised</code>, <code>DisputeResolved</code>, and milestone events. Contract guards cover role/state validation, transfer failures, exact token balance deltas, and reentrancy on funding/settlement.</p>
      <p>The buyer may call <code>requestReviewExtension</code> once during an active review to add another three days. This function exists in the contract but is not currently exposed by the SDK ABI. Likewise, parties can vote on a matching dispute outcome via <code>approveDisputeResolution</code> in Solidity; the current SDK exposes arbitrator settlement only. The web references therefore do not present these contract-only calls as SDK actions.</p>
      <div class="callout warning"><p><strong>Trust consideration:</strong> the deploying account becomes the immutable arbitrator and can settle disputes and allowlist ERC-20s. This is a centralization assumption, not a governance system.</p></div>
    </section>

    <section class="section" id="mcp">
      <div class="eyebrow">06 · Agent integration</div><h2>MCP server</h2>
      <p>The stdio MCP server wraps the same SDK and configured local chain. Read tools are available without a signer. Transaction tools are disabled by default; enabling them gives the configured signer write capability, not a per-operation human approval prompt.</p>
      <div class="table-wrap"><table><thead><tr><th>Tool</th><th>Inputs</th><th>Kind</th></tr></thead><tbody>
        <tr><td><code>create_escrow</code></td><td>seller, amount, optional token/deadline</td><td>Write</td></tr>
        <tr><td><code>get_escrow</code></td><td>escrowId</td><td>Read</td></tr>
        <tr><td><code>fund_escrow</code></td><td>escrowId</td><td>Write</td></tr>
        <tr><td><code>release_escrow</code></td><td>escrowId</td><td>Write</td></tr>
        <tr><td><code>refund_escrow</code></td><td>escrowId</td><td>Write</td></tr>
        <tr><td><code>raise_dispute</code></td><td>escrowId, reason (1–1024 UTF-8 bytes)</td><td>Write</td></tr>
        <tr><td><code>resolve_dispute</code></td><td>escrowId, releaseToSeller</td><td>Write</td></tr>
        <tr><td><code>get_transaction</code></td><td>transactionHash</td><td>Read</td></tr>
      </tbody></table></div>
      <p>Required configuration: <code>ESCROW_RPC_URL</code>, <code>ESCROW_CHAIN_NAME</code>, <code>ESCROW_CHAIN_ID</code>, <code>ESCROW_CONTRACT_ADDRESS</code>. Token use requires <code>ESCROW_TOKEN_CONFIG_JSON</code>. Write tools additionally need a local-only <code>ESCROW_PRIVATE_KEY</code> and <code>ESCROW_ENABLE_WRITE_TOOLS=true</code>.</p>
      <p>For example, an MCP client can start the server read-only with the actual local deployment configuration:</p>
      ${codeBlock([
        "{",
        '  "servers": {',
        '    "universal-escrow": {',
        '      "type": "stdio",',
        '      "command": "node",',
        '      "args": ["C:\\\\path\\\\to\\\\universal-escrow-protocol\\\\dist\\\\mcp\\\\server.js"],',
        '      "env": {',
        '        "ESCROW_RPC_URL": "http://127.0.0.1:8545",',
        '        "ESCROW_CHAIN_NAME": "hardhat-local",',
        '        "ESCROW_CHAIN_ID": "31337",',
        '        "ESCROW_CONTRACT_ADDRESS": "<address-from-deployments-local-json>",',
        '        "ESCROW_ENABLE_WRITE_TOOLS": "false"',
        "      }",
        "    }",
        "  }",
        "}",
      ].join("\n"))}
      ${codeBlock("npm run mcp")}
      <p>Tool schemas validate their inputs. Failures are returned as MCP tool errors; underlying contract authorization still applies.</p>
    </section>

    <section class="section" id="security">
      <div class="eyebrow">07 · Safer integrations</div><h2>Errors, security, best practices</h2>
      <div class="grid-2">
        <article class="card"><h3>Wait for receipts</h3><p>Wallet approval is not confirmation. Treat a transaction as complete only after the SDK returns a confirmed receipt; account for pending, reverted and reorganized transactions in production.</p></article>
        <article class="card"><h3>Check the connected network</h3><p>The SDK checks configured chain ID and deployed contract code. The browser reference expects local chain 31337; an RPC endpoint can still be stale or untrusted.</p></article>
        <article class="card"><h3>Render actions by role and state</h3><p>Disable actions that do not match the connected address, current status, deadlines or approval state. The contract remains authoritative if state changes between read and write.</p></article>
        <article class="card"><h3>Protect signers and tokens</h3><p>Use dedicated low-value development keys locally. Review token contracts before allowlisting; fee-on-transfer tokens are rejected, but allowlisting does not make arbitrary token code safe.</p></article>
      </div>
      <h3>Errors the current SDK surfaces</h3>
      <p>Configuration and validation failures use <code>EscrowSdkError</code> codes such as <code>UNSUPPORTED_CHAIN</code>, <code>WRONG_NETWORK</code>, <code>CONTRACT_NOT_DEPLOYED</code>, <code>WALLET_REQUIRED</code>, <code>INVALID_ADDRESS</code>, <code>UNSUPPORTED_TOKEN</code>, <code>APPROVAL_FAILED</code>, <code>TRANSACTION_FAILED</code>, and <code>TRANSACTION_REVERTED</code>. Wallet rejection and RPC errors are not silently treated as success. Contract failures can be wrapped as transaction errors with a decoded reason where available.</p>
      <div class="callout warning"><p>This is an educational reference integration, not an audit, security certification, production deployment, or recommendation to use real funds. See <code>docs/security.md</code> for the existing threat model and residual risks.</p></div>
    </section>

    <section class="section" id="examples">
      <div class="eyebrow">08 · Apply the same protocol</div><h2>Two products, one escrow SDK</h2>
      <p class="section-intro">The freelance example makes project deliverables and sequential milestone payouts visible. The P2P example is a compact buyer/seller transaction flow. Their copy and product journeys differ; both use the same contract and typed SDK.</p>
      <div class="grid-2">
        <article class="card route-card"><div><span class="tag">PROJECT WORKSPACE</span><h3>Freelance Escrow</h3><p>Client and freelancer identities, milestone progress and the review / payout path. Project notes are browser-local; only supported escrow terms are on-chain.</p></div><a href="/examples/freelance-escrow">Open freelance reference →</a></article>
        <article class="card route-card"><div><span class="tag">DIRECT TRANSACTION</span><h3>P2P Escrow</h3><p>Compact asset agreement with buyer/seller roles, funding, delivery, approval, timeout and the arbitrated dispute path.</p></div><a href="/examples/p2p-escrow">Open P2P reference →</a></article>
      </div>
    </section>
    <footer class="section"><p>Universal Escrow Protocol · Local development environment · Not professionally audited</p></footer>
  </div></main></div>`;
}

function getReadSdk(): Escrow {
  if (!contractAddress || !isAddress(contractAddress)) {
    throw new Error("Set VITE_ESCROW_CONTRACT_ADDRESS from deployments/local.json and restart the docs app.");
  }
  return new Escrow({
    chain: { name: "hardhat-local", chainId },
    provider: localProvider,
    contractAddress,
    tokens: tokenConfiguration,
  });
}

function getWriteSdk(): Escrow {
  if (!provider || !signer || !account) throw new Error("Connect a wallet before submitting a transaction.");
  if (connectedChain !== chainId) throw new Error("Switch your wallet to Hardhat Local (chain 31337) before sending transactions.");
  if (!contractAddress || !isAddress(contractAddress)) {
    throw new Error("Set VITE_ESCROW_CONTRACT_ADDRESS from deployments/local.json and restart the docs app.");
  }
  return new Escrow({
    chain: { name: "hardhat-local", chainId },
    wallet: signer,
    provider,
    contractAddress,
    tokens: tokenConfiguration,
  });
}

function keyFor(prefix: string, id: string): string {
  return `uep:${prefix}:${contractAddress.toLowerCase()}:${id}`;
}

function loadMetadata(id: string): AppMetadata | null {
  try {
    const saved = localStorage.getItem(keyFor("metadata", id));
    return saved ? (JSON.parse(saved) as AppMetadata) : null;
  } catch (error) {
    metadataWarning = `Project/deal notes could not be loaded from this browser: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

function saveMetadata(id: string, value: AppMetadata): void {
  try {
    localStorage.setItem(keyFor("metadata", id), JSON.stringify(value));
  } catch (error) {
    metadataWarning = `On-chain escrow was created, but these application notes could not be saved locally: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function loadActivity(id: string): SavedTransaction[] {
  try {
    const saved = localStorage.getItem(keyFor("activity", id));
    return saved ? (JSON.parse(saved) as SavedTransaction[]) : [];
  } catch (error) {
    metadataWarning = `Locally recorded transaction history is unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return [];
  }
}

function saveActivity(id: string, transaction: TransactionResult, label: string): void {
  const history = loadActivity(id);
  const eventNames = transaction.events.map(({ name }) => name);
  history.unshift({
    label,
    hash: transaction.hash,
    blockNumber: transaction.receipt.blockNumber,
    events: eventNames,
  });
  try {
    localStorage.setItem(keyFor("activity", id), JSON.stringify(history.slice(0, 24)));
  } catch (error) {
    metadataWarning = `Transaction confirmed on-chain, but its local activity record could not be saved: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function noticeHtml(): string {
  if (!notice) return "";
  return `<div class="notice ${noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : ""}" role="${noticeKind === "error" ? "alert" : "status"}">${escapeHtml(notice)}</div>`;
}

function connectionStatus(): string {
  if (!window.ethereum) return "No injected wallet";
  if (!account) return `Wallet disconnected${connectedChain === null ? "" : ` · selected ${chainLabel(connectedChain)}`}`;
  return `Wallet ${shortAddress(account)} · selected ${chainLabel(connectedChain)}`;
}

function chainLabel(id: bigint | null): string {
  if (id === null) return "unknown chain";
  if (id === chainId) return "Hardhat Local (31337)";
  if (id === 11155111n) return "Sepolia (11155111)";
  return `chain ${id}`;
}

function deploymentStatusMarkup(): string {
  const addressConfigured = Boolean(contractAddress && isAddress(contractAddress));
  const rpcStatus =
    localRpcChain === null
      ? `RPC not verified · ${rpcUrl}`
      : localRpcChain === chainId
        ? `Local RPC ready · chain ${localRpcChain}`
        : `RPC chain mismatch · ${localRpcChain} (expected ${chainId})`;
  const contractStatus = !addressConfigured
    ? "Contract address missing or invalid"
    : contractCodeAvailable === true
      ? `Contract verified · ${shortAddress(contractAddress)}`
      : contractCodeAvailable === false
        ? `No contract code at ${shortAddress(contractAddress)}`
        : `Checking contract · ${shortAddress(contractAddress)}`;
  const tokenStatus = !tokenAddress
    ? "Optional mUSDC address not configured"
    : !isAddress(tokenAddress)
      ? "mUSDC address invalid"
      : tokenCodeAvailable === true
        ? `mUSDC mock token verified · ${shortAddress(tokenAddress)}`
        : tokenCodeAvailable === false
          ? `No token code at ${shortAddress(tokenAddress)}`
          : `Checking mUSDC · ${shortAddress(tokenAddress)}`;
  const ready = addressConfigured && localRpcChain === chainId && contractCodeAvailable === true;
  return `<section class="deployment-status ${ready ? "ready" : "not-ready"}" role="status" aria-live="polite">
    <div><strong>Contract deployment</strong><span>${escapeHtml(contractStatus)}</span></div>
    <div><strong>Configured network</strong><span>${escapeHtml(rpcStatus)}</span></div>
    <div><strong>Token</strong><span>${escapeHtml(tokenStatus)}</span></div>
    <div><strong>Wallet</strong><span>${escapeHtml(connectionStatus())}</span></div>
    ${configurationError ? `<p class="deployment-error">${escapeHtml(configurationError)}</p>` : ""}
  </section>`;
}

function walletButton(): string {
  if (!account) return `<button class="button" type="button" data-action="connect" ${busy ? "disabled" : ""}>Connect wallet</button>`;
  if (connectedChain !== chainId) return `<button class="button" type="button" data-action="switch-network" ${busy ? "disabled" : ""}>Switch to Hardhat Local · 31337</button>`;
  return `<button class="button secondary" type="button" data-action="disconnect">${escapeHtml(shortAddress(account))}</button>`;
}

function lookupForm(): string {
  return `<form class="lookup-form" data-form="lookup" aria-label="Read escrow by id"><label class="sr-only" for="lookup-id">Escrow ID</label><input id="lookup-id" name="escrowId" inputmode="numeric" pattern="[0-9]+" placeholder="Read an escrow by ID" value="${escapeHtml(loadedEscrowId ?? "")}" required/><button class="button secondary" type="submit" ${busy ? "disabled" : ""}>Load</button></form>`;
}

function statusPill(status: string): string {
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function tokenName(details: EscrowDetails): string {
  if (details.token.toLowerCase() === ZeroAddress.toLowerCase()) return "ETH";
  if (tokenAddress && details.token.toLowerCase() === tokenAddress.toLowerCase()) return "mUSDC";
  return shortAddress(details.token);
}

function displayAmount(amount: bigint, token: string): string {
  const decimals = token === "ETH" ? 18 : token === "mUSDC" ? 6 : null;
  const formatted = decimals === null ? `${amount.toString()} base units` : formatUnits(amount, decimals);
  return `${formatted} ${escapeHtml(token)}`;
}

function currentMetadata(): AppMetadata | null {
  return loadedEscrowId ? loadMetadata(loadedEscrowId) : null;
}

function activityMarkup(): string {
  if (!loadedEscrowId) return `<p class="muted">Load an escrow to view confirmed actions recorded by this browser.</p>`;
  const history = loadActivity(loadedEscrowId);
  if (history.length === 0) {
    return `<p class="muted">No transaction history has been recorded in this browser. Current state above is read from the chain; past local activity may be unavailable.</p>`;
  }
  return `<div class="activity-list">${history
    .map(
      (item) =>
        `<div class="activity-item"><strong>${escapeHtml(item.label)}</strong><small>Confirmed in block ${escapeHtml(item.blockNumber)}${item.events.length ? ` · ${escapeHtml(item.events.join(", "))}` : ""}</small><button class="transaction-id copy-transaction" type="button" data-copy-value="${escapeHtml(item.hash)}" aria-label="Copy transaction hash">${escapeHtml(item.hash)}</button></div>`,
    )
    .join("")}</div><p class="form-note">Hashes and decoded events were returned by confirmed SDK transactions and saved locally in this browser. This is not a complete chain-wide event index.</p>`;
}

function projectMilestonesMarkup(): string {
  if (!currentDetails?.milestoneMode || !currentProgress) {
    return `<div class="notice">The protocol stores one amount for this deal. Project titles, briefs and files belong to your application; they are not written into this contract.</div>`;
  }
  return `<div class="milestone-list">${currentProgress.amounts
    .map((amount, index) => {
      const completed = index < currentProgress!.completed;
      return `<div class="milestone-row ${completed ? "done" : ""}"><span class="milestone-dot">${completed ? "✓" : index + 1}</span><span>${escapeHtml(currentMetadata()?.labels[index] ?? `Milestone ${index + 1}`)}${currentProgress!.delivered[index] && !completed ? " · submitted for review" : ""}</span><strong>${displayAmount(amount, tokenName(currentDetails!))}</strong></div>`;
    })
    .join("")}</div>`;
}

function p2pFlowMarkup(status: string): string {
  const states = ["created", "funded", "delivered", "released"];
  const position =
    status === "refunded" || status === "cancelled"
      ? -1
      : status === "disputed"
        ? states.indexOf("delivered")
        : states.indexOf(status);
  return `<div class="flow-steps" aria-label="Transaction progress">${states
    .map((state, index) => `<div class="flow-step ${position >= index ? "active" : ""}">${state}</div>`)
    .join("")}</div>`;
}

function actionButtons(mode: "freelance" | "p2p"): string {
  if (!currentDetails || !account || connectedChain !== chainId) return "";
  const detail = currentDetails;
  const isBuyer = account.toLowerCase() === detail.buyer.toLowerCase();
  const isSeller = account.toLowerCase() === detail.seller.toLowerCase();
  const isParty = isBuyer || isSeller || accountIsApprover;
  const timeOpen = chainTimestamp === 0n || detail.reviewDeadline === 0n || chainTimestamp <= detail.reviewDeadline;
  const afterReview = detail.reviewDeadline > 0n && chainTimestamp > detail.reviewDeadline;
  const beforeFundingDeadline = detail.deadline === 0n || chainTimestamp <= detail.deadline;
  const buttons: Array<{ action: string; label: string; primary?: boolean }> = [];
  if (detail.status === "created" && isBuyer) {
    if (beforeFundingDeadline) buttons.push({ action: "fund", label: "Fund escrow", primary: true });
    buttons.push({ action: "cancel", label: "Cancel before funding" });
  }
  if (detail.status === "funded" && isSeller) {
    buttons.push({ action: mode === "freelance" ? "submit-milestone" : "submit-delivery", label: mode === "freelance" ? "Submit next milestone" : "Submit delivery", primary: true });
  }
  if (detail.status === "funded" && detail.deadline > 0n && chainTimestamp > detail.deadline) {
    buttons.push({ action: "refund", label: "Refund expired undelivered escrow" });
  }
  if (detail.status === "delivered") {
    if (mode === "freelance" && detail.milestoneMode && isBuyer && timeOpen) {
      buttons.push({ action: "approve-milestone", label: "Approve milestone", primary: true });
    } else if (mode === "freelance" && detail.milestoneMode && afterReview) {
      buttons.push({ action: "release-milestone-timeout", label: "Release milestone after review timeout" });
    } else if (mode === "p2p" && !detail.milestoneMode && isParty && timeOpen && !approvedByAccount) {
      buttons.push({ action: "release", label: `Approve release (${detail.approvalCount}/${detail.approvalThreshold})`, primary: true });
    } else if (mode === "p2p" && !detail.milestoneMode && afterReview && !detail.multiParty) {
      buttons.push({ action: "release-timeout", label: "Release after review timeout" });
    }
    if (isParty && (detail.multiParty || timeOpen)) {
      buttons.push({ action: "dispute", label: "Raise a dispute" });
    }
  }
  if (detail.status === "disputed" && arbitrator && account.toLowerCase() === arbitrator.toLowerCase()) {
    buttons.push({ action: "resolve-seller", label: "Resolve to seller", primary: true });
    buttons.push({ action: "resolve-buyer", label: "Resolve to buyer" });
  }
  if (!buttons.length) {
    const message =
      detail.status === "disputed"
        ? "Only the deployment's immutable arbitrator can settle through the current SDK."
        : detail.status === "delivered" && mode === "p2p" && approvedByAccount
          ? "Your release approval is recorded. The other approver must approve before settlement."
          : "No action is available to this wallet in the current state.";
    return `<p class="form-note">${escapeHtml(message)}</p>`;
  }
  return `<div class="action-list">${buttons
    .map(({ action, label, primary }) => `<button class="button ${primary ? "" : "secondary"}" type="button" data-action="${action}" ${busy ? "disabled" : ""}>${escapeHtml(label)}</button>`)
    .join("")}</div>${detail.status === "delivered" ? `<label class="field" style="margin-top:13px"><span>Dispute reason (if needed)</span><textarea id="dispute-reason" maxlength="1024" placeholder="Describe the issue. Required to raise a dispute."></textarea></label>` : ""}`;
}

function escrowSummary(mode: "freelance" | "p2p"): string {
  if (!currentDetails) return `<div class="status-card"><h3>On-chain escrow</h3>${contractAddress && isAddress(contractAddress) ? `<p>Connect a wallet, then create an escrow or load its numeric ID to read live contract state.</p>` : `<div class="notice error">No contract configured. Set VITE_ESCROW_CONTRACT_ADDRESS using deployments/local.json, then restart Vite.</div>`}</div>`;
  const detail = currentDetails;
  const token = tokenName(detail);
  const metadata = currentMetadata();
  const amount = detail.milestoneMode && currentProgress
    ? currentProgress.amounts.reduce((total, value) => total + value, 0n)
    : detail.amount;
  const title = metadata?.title ?? `Escrow ${detail.id}`;
  const description = metadata?.description ?? "No application notes were saved for this escrow in this browser.";
  if (mode === "p2p") {
    return `<section class="deal-panel" aria-label="Live transaction details">
      <div class="deal-top"><div><small>On-chain escrow · #${escapeHtml(detail.id)}</small><h2>${escapeHtml(title)}</h2></div>${statusPill(detail.status)}</div>
      ${p2pFlowMarkup(detail.status)}
      <div class="deal-amount"><small>Agreed amount · ${escapeHtml(token)}</small><strong>${displayAmount(amount, token)}</strong></div>
      <div class="deal-details">
        ${keyValue("Buyer", detail.buyer)}${keyValue("Seller", detail.seller)}
        ${keyValue("Remaining in escrow", displayAmount(detail.remainingAmount, token))}
        ${keyValue("Approval threshold", `${detail.approvalCount} / ${detail.approvalThreshold}`)}
        ${keyValue("Funding deadline", detail.deadline === 0n ? "Not set" : dateFromUnix(detail.deadline))}
        ${keyValue("Review deadline", detail.reviewDeadline === 0n ? "Not started" : dateFromUnix(detail.reviewDeadline))}
        <p class="form-note">${escapeHtml(description)}</p>
        ${actionButtons(mode)}
      </div>
    </section>`;
  }
  return `<section class="project-card" aria-label="Freelance project and live escrow">
    <div class="project-cover"><span class="project-label">Freelance project · escrow #${escapeHtml(detail.id)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
    <div class="project-body">
      <div class="party-row"><div class="party"><small>Client / buyer</small><code>${escapeHtml(detail.buyer)}</code></div><div class="party"><small>Freelancer / seller</small><code>${escapeHtml(detail.seller)}</code></div></div>
      <div class="status-line"><strong>Delivery plan</strong>${statusPill(detail.status)}</div>
      ${projectMilestonesMarkup()}
      <div class="key-value"><span>Agreed value</span><strong>${displayAmount(amount, token)}</strong></div>
      <div class="key-value"><span>Remaining escrow</span><strong>${displayAmount(detail.remainingAmount, token)}</strong></div>
      <div class="key-value"><span>Review window</span><strong>${detail.reviewDeadline === 0n ? "Begins when a milestone is submitted" : dateFromUnix(detail.reviewDeadline)}</strong></div>
      ${actionButtons(mode)}
    </div>
  </section>`;
}

function keyValue(label: string, value: string): string {
  return `<div class="key-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function dateFromUnix(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleString();
}

function renderReference(mode: "freelance" | "p2p"): void {
  const freelance = mode === "freelance";
  const pageClass = freelance ? "freelance-page" : "p2p-page";
  document.body.className = pageClass;
  document.title = `${freelance ? "Freelance Escrow" : "P2P Escrow"} — Universal Escrow Protocol`;
  const meta = currentMetadata();
  const tokenOptions = `<option value="ETH">ETH · native local test asset</option>${tokenConfiguration.mUSDC ? `<option value="mUSDC">mUSDC · local mock token</option>` : ""}`;
  const createForm = freelance
    ? `<form class="form-card" data-form="create-freelance">
        <h3>Set up a project escrow</h3><p class="form-note">The client creates one escrow with sequential, funded milestones. These project labels remain in this browser; contract state contains the total, parties and tranches.</p>
        <div class="field"><label for="project-title">Project name · local note</label><input id="project-title" name="title" placeholder="Brand identity refresh" maxlength="90" required/></div>
        <div class="field"><label for="project-description">Brief · local note</label><textarea id="project-description" name="description" placeholder="A short project context for this browser." maxlength="500"></textarea></div>
        <div class="form-grid"><div class="field"><label for="freelancer-address">Freelancer address</label><input id="freelancer-address" name="seller" placeholder="0x…" autocomplete="off" required/></div>
        <div class="field"><label for="freelance-token">Asset</label><select id="freelance-token" name="token">${tokenOptions}</select></div></div>
        <div class="field"><label for="milestone-amounts">Milestone amounts · one positive amount per line</label><textarea id="milestone-amounts" name="amounts" placeholder="0.03&#10;0.02" required></textarea></div>
        <div class="field"><label for="milestone-labels">Milestone names · optional, matching order</label><textarea id="milestone-labels" name="labels" placeholder="Design direction&#10;Final files"></textarea></div>
        <div class="field"><label for="freelance-deadline">Funding deadline · local time</label><input id="freelance-deadline" name="deadline" type="datetime-local"/></div>
        <button class="button" type="submit" ${busy || !account || connectedChain !== chainId ? "disabled" : ""}>${busy ? "Waiting for wallet…" : "Create milestone escrow"}</button>
      </form>`
    : `<form class="form-card" data-form="create-p2p">
        <h3>Open a transaction</h3><p class="form-note">Create one buyer-funded escrow. The seller submits delivery; buyer and seller approve release, or a party may raise a dispute during review.</p>
        <div class="form-grid"><div class="field"><label for="seller-address">Seller address</label><input id="seller-address" name="seller" placeholder="0x…" autocomplete="off" required/></div>
        <div class="field"><label for="p2p-amount">Amount</label><input id="p2p-amount" name="amount" type="number" min="0.000001" step="any" placeholder="0.05" required/></div></div>
        <div class="form-grid"><div class="field"><label for="p2p-token">Asset</label><select id="p2p-token" name="token">${tokenOptions}</select></div>
        <div class="field"><label for="p2p-title">Transaction label · local note</label><input id="p2p-title" name="title" placeholder="Used camera sale" maxlength="90" required/></div></div>
        <div class="field"><label for="p2p-description">Terms summary · local note</label><textarea id="p2p-description" name="description" placeholder="Describe the item or exchange. Notes are not stored on-chain." maxlength="500"></textarea></div>
        <div class="field"><label for="p2p-deadline">Funding deadline · local time</label><input id="p2p-deadline" name="deadline" type="datetime-local"/></div>
        <button class="button" type="submit" ${busy || !account || connectedChain !== chainId ? "disabled" : ""}>${busy ? "Waiting for wallet…" : "Create escrow"}</button>
      </form>`;

  app!.innerHTML = `<div class="demo-page ${pageClass}">
    <header class="demo-top"><div class="demo-top-left"><a href="/" aria-label="Back to documentation">← Docs</a><span class="demo-name">${freelance ? "Fieldnote / Projects" : "SWAP / escrow"}</span></div>
      <div class="demo-top-right"><span class="wallet-state">${escapeHtml(connectionStatus())}</span>${walletButton()}</div>
    </header>
    <main class="demo-content">
      <div class="demo-heading"><div><div class="eyebrow">${freelance ? "Reference integration · project workspace" : "Reference integration · peer transaction"}</div><h1>${freelance ? "Work, funded with clarity." : "A direct deal. Held fairly."}</h1><p>${freelance ? "A client and freelancer share one milestone-backed agreement on the same escrow contract." : "A buyer and seller use one compact, on-chain agreement for a peer-to-peer exchange."}</p></div>
        <a class="button secondary" href="${freelance ? "/examples/p2p-escrow" : "/examples/freelance-escrow"}">Try ${freelance ? "P2P" : "freelance"} example →</a>
      </div>
      ${noticeHtml()}
      ${metadataWarning ? `<div class="notice">${escapeHtml(metadataWarning)}</div>` : ""}
      ${!window.ethereum ? `<div class="notice error">No injected EVM wallet was detected. Install/use a browser wallet configured for the local Hardhat chain; the UI never simulates transactions.</div>` : ""}
      ${connectedChain !== null && connectedChain !== chainId ? `<div class="notice error">Wallet selected ${escapeHtml(chainLabel(connectedChain))}. The configured deployment is on Hardhat Local (chain 31337). Switch networks using the button above; no network change or transaction is automatic.</div>` : ""}
      ${!contractAddress || !isAddress(contractAddress) ? `<div class="notice error">VITE_ESCROW_CONTRACT_ADDRESS is missing or invalid. Use the address from deployments/local.json in the workspace root .env.local, then restart Vite.</div>` : ""}
      ${deploymentStatusMarkup()}
      <div class="${freelance ? "freelance-shell" : "p2p-grid"}">
        <div class="main-column">
          ${lookupForm()}
          ${currentDetails ? escrowSummary(mode) : createForm}
        </div>
        <aside class="side-stack">
          <section class="${freelance ? "status-card" : "txn-card"}">
            <div class="status-line"><h3>${freelance ? "Escrow overview" : "Transaction monitor"}</h3>${currentDetails ? statusPill(currentDetails.status) : `<span class="tag">LOCAL · 31337</span>`}</div>
            ${currentDetails ? `${keyValue("Escrow ID", currentDetails.id.toString())}${keyValue("Network", `Hardhat Local · ${chainId}`)}${keyValue("Asset", tokenName(currentDetails))}${keyValue("Transaction role", account ? account.toLowerCase() === currentDetails.buyer.toLowerCase() ? "Buyer / client" : account.toLowerCase() === currentDetails.seller.toLowerCase() ? "Seller / freelancer" : accountIsApprover ? "Configured approver" : account.toLowerCase() === arbitrator?.toLowerCase() ? "Arbitrator" : "Observer" : "Not connected")}` : `<p>Actions appear only when this wallet and the live escrow state permit them.</p><div class="notice">Connect a local development wallet. Reads and writes use the configured address and injected wallet; no activity is fabricated.</div>`}
          </section>
          <section class="activity-card"><div class="status-line"><h3>${freelance ? "Project activity" : "Confirmed transactions"}</h3><span class="tag">THIS BROWSER</span></div>${activityMarkup()}</section>
          ${freelance ? `<section class="status-card"><h3>Why this is a milestone escrow</h3><p>Sequential tranches are supported by this contract. Every milestone amount contributes to one funded total; each release reduces the remaining balance. Project files and labels do not go on-chain.</p><a href="/#contract-reference">See contract behavior →</a></section>` : `<section class="status-card"><h3>Deal rules</h3><p>The buyer funds. The seller marks delivery. Both parties approve release before the three-day review deadline. After review, timeout release is permissionless unless multi-party mode is configured.</p><a href="/#lifecycle">Review lifecycle →</a></section>`}
        </aside>
      </div>
      <section class="section" style="margin-top:28px"><div class="eyebrow">Integration note</div><h2>${freelance ? "A project UX over a shared settlement layer." : "Compact UI, unchanged escrow rules."}</h2><p>${freelance ? "Project title and brief are browser-local labels. Milestone amounts, parties, status and payouts come from the actual contract via the SDK. Both examples reuse the same Escrow SDK and contract." : "The transaction card reads live chain fields. It does not create a fake balance or copy a marketplace state machine into frontend code. Both examples use the same SDK and escrow contract."}</p><a href="/#sdk-reference">SDK and API reference →</a></section>
    </main>
  </div>`;
}

async function connectWallet(): Promise<void> {
  if (!window.ethereum) throw new Error("No injected EVM wallet was detected.");
  provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
  const addresses = (await provider.send("eth_requestAccounts", [])) as string[];
  account = addresses[0] ?? null;
  if (!account) throw new Error("The wallet did not return a connected account.");
  signer = await provider.getSigner(account);
  connectedChain = (await provider.getNetwork()).chainId;
  if (loadedEscrowId && connectedChain === chainId) await refreshEscrow(loadedEscrowId);
}

async function switchToLocalNetwork(): Promise<void> {
  if (!window.ethereum) throw new Error("No injected EVM wallet was detected.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7a69" }],
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 4902)) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x7a69",
        chainName: "Hardhat Local",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["http://127.0.0.1:8545"],
      }],
    });
  }
  if (window.ethereum) {
    provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
    connectedChain = (await provider.getNetwork()).chainId;
    if (account) signer = await provider.getSigner(account);
    if (loadedEscrowId && connectedChain === chainId) await refreshEscrow(loadedEscrowId);
  }
}

async function refreshEscrow(id: string): Promise<void> {
  if (!/^(0|[1-9]\d*)$/.test(id)) throw new Error("Escrow ID must be a non-negative integer.");
  const readSdk = getReadSdk();
  const details = await readSdk.getEscrow(id);
  const latest = await readSdk.getChainTimestamp();
  const readContract = new Contract(contractAddress, [
    "function arbitrator() view returns (address)",
    "function releaseApprovals(uint256,address) view returns (bool)",
    "function releaseApprover(uint256,address) view returns (bool)",
  ], localProvider);
  const [arbitratorAddress, alreadyApproved, isConfiguredApprover] = await Promise.all([
    readContract.getFunction("arbitrator").staticCall() as Promise<string>,
    account && !details.milestoneMode
      ? readContract.getFunction("releaseApprovals").staticCall(details.id, account) as Promise<boolean>
      : Promise.resolve(false),
    account
      ? readContract.getFunction("releaseApprover").staticCall(details.id, account) as Promise<boolean>
      : Promise.resolve(false),
  ]);
  currentDetails = details;
  currentProgress = details.milestoneMode ? await readSdk.getMilestoneProgress(details.id) : null;
  arbitrator = arbitratorAddress;
  approvedByAccount = alreadyApproved;
  accountIsApprover = isConfiguredApprover;
  chainTimestamp = latest;
  loadedEscrowId = id;
}

async function checkLocalDeployment(): Promise<void> {
  try {
    localRpcChain = (await localProvider.getNetwork()).chainId;
    if (localRpcChain !== chainId) {
      contractCodeAvailable = false;
      tokenCodeAvailable = false;
      configurationError = `Configured local RPC returned chain ${localRpcChain}; expected ${chainId}.`;
      render();
      return;
    }
    if (!contractAddress || !isAddress(contractAddress)) {
      contractCodeAvailable = false;
      configurationError = "VITE_ESCROW_CONTRACT_ADDRESS is missing or invalid. Set it from deployments/local.json and restart Vite.";
    } else {
      contractCodeAvailable = (await localProvider.getCode(contractAddress)) !== "0x";
      configurationError = contractCodeAvailable
        ? ""
        : `No contract bytecode at ${contractAddress} on local chain ${chainId}; verify the deployment belongs to the running node.`;
    }
    tokenCodeAvailable =
      Boolean(tokenAddress && isAddress(tokenAddress)) &&
      (await localProvider.getCode(tokenAddress)) !== "0x";
    render();
  } catch (error) {
    localRpcChain = null;
    contractCodeAvailable = false;
    tokenCodeAvailable = false;
    configurationError = `Could not verify the local deployment via ${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`;
    render();
  }
}

async function performAction(action: string): Promise<void> {
  const id = currentDetails?.id;
  if (id === undefined) throw new Error("Load a valid escrow before choosing an action.");
  const sdk = getWriteSdk();
  let result: TransactionResult;
  let label: string;
  switch (action) {
    case "fund":
      result = await sdk.deposit(id);
      label = "Funded escrow";
      break;
    case "cancel":
      result = await sdk.cancel(id);
      label = "Cancelled before funding";
      break;
    case "refund":
      result = await sdk.refund(id);
      label = "Refunded expired undelivered escrow";
      break;
    case "submit-delivery":
      result = await sdk.submitDelivery(id);
      label = "Submitted delivery";
      break;
    case "release":
      result = await sdk.release(id);
      label = "Approved release";
      break;
    case "release-timeout":
      result = await sdk.releaseAfterTimeout(id);
      label = "Released after review timeout";
      break;
    case "submit-milestone":
      result = await sdk.submitMilestone(id);
      label = "Submitted milestone";
      break;
    case "approve-milestone":
      result = await sdk.approveMilestone(id);
      label = "Approved milestone";
      break;
    case "release-milestone-timeout":
      result = await sdk.releaseMilestoneAfterTimeout(id);
      label = "Released milestone after review timeout";
      break;
    case "dispute": {
      const reason = document.querySelector<HTMLTextAreaElement>("#dispute-reason")?.value ?? "";
      result = await sdk.dispute(id, reason);
      label = "Raised dispute";
      break;
    }
    case "resolve-seller":
      result = await sdk.resolve(id, true);
      label = "Arbitrator resolved to seller";
      break;
    case "resolve-buyer":
      result = await sdk.resolve(id, false);
      label = "Arbitrator resolved to buyer";
      break;
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
  metadataWarning = "";
  saveActivity(id.toString(), result, label);
  notice = `${label} confirmed in block ${result.receipt.blockNumber}. Transaction: ${result.hash}`;
  noticeKind = "success";
  await refreshEscrow(id.toString());
}

function readDeadline(value: FormDataEntryValue | null): bigint | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Enter a valid future funding deadline.");
  if (BigInt(timestamp) <= chainTimestamp) throw new Error("Funding deadline must be in the future.");
  return BigInt(timestamp);
}

function connectListeners(): void {
  void checkLocalDeployment();
  if (!window.ethereum) {
    render();
    return;
  }
  window.ethereum.on("accountsChanged", (value) => {
    account = Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
    signer = null;
    currentDetails = null;
    if (account && provider) {
      void provider.getSigner(account).then((nextSigner) => {
        signer = nextSigner;
        return loadedEscrowId && connectedChain === chainId ? refreshEscrow(loadedEscrowId) : undefined;
      }).then(render).catch(showError);
    } else render();
  });
  window.ethereum.on("chainChanged", (value) => {
    connectedChain =
      typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)
        ? BigInt(value)
        : null;
    signer = null;
    if (account && connectedChain === chainId && provider) {
      void provider
        .getSigner(account)
        .then((nextSigner) => {
          signer = nextSigner;
          render();
        })
        .catch(showError);
      return;
    }
    render();
  });
  void (async () => {
    try {
      provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      const addresses = (await provider.send("eth_accounts", [])) as string[];
      account = addresses[0] ?? null;
      connectedChain = (await provider.getNetwork()).chainId;
      signer = account ? await provider.getSigner(account) : null;
      if (loadedEscrowId && connectedChain === chainId) await refreshEscrow(loadedEscrowId);
    } catch (error) {
      showError(error);
      return;
    }
    render();
  })();
}

function showError(error: unknown): void {
  notice = error instanceof Error ? error.message : String(error);
  noticeKind = "error";
  busy = false;
  render();
}

function render(): void {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  currentDetails = currentDetails && loadedEscrowId === currentDetails.id.toString() ? currentDetails : null;
  currentProgress = currentDetails ? currentProgress : null;
  if (path === "/examples/freelance-escrow") {
    renderReference("freelance");
  } else if (path === "/examples/p2p-escrow") {
    renderReference("p2p");
  } else {
    renderDocs();
  }
}

function navigateTo(path: string): void {
  history.pushState({}, "", path);
  notice = "";
  metadataWarning = "";
  currentDetails = null;
  currentProgress = null;
  loadedEscrowId = null;
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a");
  if (link?.origin === window.location.origin && link.pathname.startsWith("/examples/")) {
    event.preventDefault();
    navigateTo(link.pathname);
    return;
  }
  const copyTransaction = target.closest<HTMLButtonElement>(".copy-transaction");
  if (copyTransaction?.dataset.copyValue) {
    event.preventDefault();
    void navigator.clipboard.writeText(copyTransaction.dataset.copyValue).then(() => {
      notice = "Transaction hash copied.";
      noticeKind = "success";
      render();
    }).catch(showError);
    return;
  }
  const copyButton = target.closest<HTMLButtonElement>(".copy-code");
  if (copyButton) {
    const source = copyButton.parentElement?.querySelector("code")?.textContent;
    if (!source) return;
    void navigator.clipboard.writeText(source).then(() => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => { copyButton.textContent = "Copy"; }, 1300);
    }).catch(showError);
    return;
  }
  const actionButton = target.closest<HTMLButtonElement>("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "connect") {
    busy = true;
    notice = "Approve the wallet connection request in your wallet.";
    noticeKind = "info";
    render();
    void connectWallet().then(() => {
      notice = connectedChain === chainId ? "Wallet connected to the local chain." : "Wallet connected on a different network. Switch to chain 31337.";
      noticeKind = connectedChain === chainId ? "success" : "error";
      busy = false;
      render();
    }).catch(showError);
  } else if (action === "switch-network") {
    busy = true;
    render();
    void switchToLocalNetwork().then(() => {
      notice = connectedChain === chainId ? "Connected to Hardhat Local." : "The wallet did not switch to chain 31337.";
      noticeKind = connectedChain === chainId ? "success" : "error";
      busy = false;
      render();
    }).catch(showError);
  } else if (action === "disconnect") {
    account = null;
    signer = null;
    currentDetails = null;
    notice = "Wallet disconnected from this interface. Revoke site access in the wallet to remove permission.";
    noticeKind = "info";
    render();
  } else if (action) {
    busy = true;
    notice = "Waiting for wallet approval and on-chain confirmation…";
    noticeKind = "info";
    render();
    void performAction(action).then(() => {
      busy = false;
      render();
    }).catch(showError);
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = new FormData(form);
  const formType = form.dataset.form;
  busy = true;
  notice = "Waiting for wallet approval and on-chain confirmation…";
  noticeKind = "info";
  render();
  void (async () => {
    try {
      if (formType === "lookup") {
        if (!contractAddress || !isAddress(contractAddress)) {
          throw new Error("Set VITE_ESCROW_CONTRACT_ADDRESS from deployments/local.json and restart Vite.");
        }
        if (localRpcChain !== chainId || contractCodeAvailable !== true) {
          throw new Error(configurationError || "The configured contract is not verified on local chain 31337.");
        }
        const id = String(data.get("escrowId") ?? "").trim();
        currentDetails = null;
        currentProgress = null;
        await refreshEscrow(id);
        notice = `Read escrow ${id} from the configured chain.`;
        noticeKind = "success";
      } else if (formType === "create-freelance") {
        const sdk = getWriteSdk();
        const seller = String(data.get("seller") ?? "").trim();
        if (!isAddress(seller)) throw new Error("Enter a valid freelancer EVM address.");
        if (account?.toLowerCase() === seller.toLowerCase()) throw new Error("The connected client cannot be their own freelancer.");
        const amounts = String(data.get("amounts") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        if (!amounts.length || amounts.some((item) => !/^\d+(\.\d+)?$/.test(item) || Number(item) <= 0)) {
          throw new Error("Enter one or more positive milestone amounts, one per line.");
        }
        if (amounts.length > 20) throw new Error("The contract supports at most 20 milestones.");
        chainTimestamp = await sdk.getChainTimestamp();
        const deadline = readDeadline(data.get("deadline"));
        const created = await sdk.createMilestoneEscrow({
          seller,
          token: String(data.get("token") ?? "ETH"),
          deadline: deadline ?? 0n,
          milestoneAmounts: amounts,
        });
        const id = created.id.toString();
        metadataWarning = "";
        saveMetadata(id, {
          title: String(data.get("title") ?? "").trim(),
          description: String(data.get("description") ?? "").trim(),
          labels: String(data.get("labels") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        });
        saveActivity(id, created, "Created freelance milestone escrow");
        loadedEscrowId = id;
        await refreshEscrow(id);
        notice = `Milestone escrow ${id} was created and confirmed in block ${created.receipt.blockNumber}.`;
        noticeKind = "success";
      } else if (formType === "create-p2p") {
        const sdk = getWriteSdk();
        const seller = String(data.get("seller") ?? "").trim();
        const amount = String(data.get("amount") ?? "").trim();
        if (!isAddress(seller)) throw new Error("Enter a valid seller EVM address.");
        if (account?.toLowerCase() === seller.toLowerCase()) throw new Error("The connected buyer cannot be their own seller.");
        if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error("Enter a positive amount.");
        chainTimestamp = await sdk.getChainTimestamp();
        const deadline = readDeadline(data.get("deadline"));
        const created = await sdk.createEscrow({
          seller,
          amount,
          token: String(data.get("token") ?? "ETH"),
          deadline,
        });
        const id = created.id.toString();
        metadataWarning = "";
        saveMetadata(id, {
          title: String(data.get("title") ?? "").trim(),
          description: String(data.get("description") ?? "").trim(),
          labels: [],
        });
        saveActivity(id, created, "Created P2P escrow");
        loadedEscrowId = id;
        await refreshEscrow(id);
        notice = `P2P escrow ${id} was created and confirmed in block ${created.receipt.blockNumber}.`;
        noticeKind = "success";
      }
      busy = false;
      render();
    } catch (error) {
      showError(error);
    }
  })();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
  if (link) {
    const id = link.getAttribute("href")?.slice(1);
    if (id && document.getElementById(id)) {
      event.preventDefault();
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState({}, "", `/#${id}`);
    }
  }
});

window.addEventListener("popstate", () => {
  currentDetails = null;
  currentProgress = null;
  loadedEscrowId = null;
  render();
});

render();
connectListeners();
