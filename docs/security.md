# Security and threat model

## Security status

This project has **not** received a professional security audit and must not
be presented as production-ready for real funds without appropriate
independent review. The automated tests exercise important expected and
adversarial cases but do not prove the absence of vulnerabilities. Slither was
not available in the project environment during this phase.

## Assets and trust boundaries

- **Protected assets:** ETH and supported ERC-20 balances held by an Escrow
  contract for the remaining amount of each active deal.
- **Untrusted callers:** any account can call public functions; contract
  authorization checks determine permitted actions.
- **Buyer:** creates and funds a deal, may cancel only before funding, and
  participates in approval and dispute workflows.
- **Seller:** receives settled funds and submits delivery/milestones.
- **Approvers:** unique, explicitly configured for multi-party deals; the
  configured threshold determines approval and party-consensus resolution.
- **Arbitrator:** the deploying account is immutable and controls token
  allowlisting and final dispute settlement. This is a centralized trust
  assumption; compromise or key loss can materially affect users.
- **Token contracts:** allowlisted tokens are external code. Allowlisting is a
  trust decision; an allowlisted token may still be upgraded, paused,
  blacklist users, revert, misreport balances, or otherwise behave
  incompatibly.
- **SDK/MCP operator:** controls RPC configuration and, when write tools are
  enabled, the signer. Enabling MCP writes lets tools send transactions with
  that signer; annotations are not a per-transaction approval mechanism.
- **RPC/network:** providers may be unavailable, stale, malicious, or subject
  to reorgs. Chain ID checks do not establish provider honesty or finality.

## Implemented mitigations and tested cases

- State transitions and caller permissions are checked in the contract;
  duplicate approvals, funding, and settlement are rejected.
- State is updated before external payout calls, and a reentrancy guard
  protects funding and settlement entry points. A callback-token test verifies
  that a callback cannot reenter the guarded escrow path.
- ETH transfer failures and ERC-20 call failures revert the operation.
  False-returning ERC-20 mocks verify that failed funding/payout does not
  corrupt recorded balances or settlement state.
- ERC-20 funding and payouts verify exact balance deltas; fee-on-transfer
  behavior is rejected. Tokens must have contract code and be allowlisted by
  the arbitrator before use.
- Multi-party deals use explicit approver membership and thresholds, bounded
  approver counts, and duplicate-address checks. Their timeout release is
  disabled rather than assuming a two-party agreement.
- Deadline checks prevent late funding; undelivered funded deals may be
  refunded after expiry when a nonzero deadline was configured. A zero
  deadline disables deadline expiry/refund. Review and milestone settlement
  have explicit transitions.
- EIP-712 signatures bind the chain ID and verifying contract, require buyer
  and seller signatures, enforce a future deadline, reject high-s signatures,
  and consume the buyer's agreement nonce.
- MCP transaction tools default to disabled; read tools are provider-only.
  Configured secrets are not intentionally returned in tool output or logs.

The current automated suite also covers rejecting ETH recipients, ETH
reentrancy, unauthorized roles, failed payout rollback, deadline boundaries,
dispute permissions, and duplicate/replay attempts. See
`test/Escrow.ts`, `test/ProtocolExtensions.ts`, `test/EscrowSdk.ts`,
`test/EscrowMcp.ts`, and `test/ReferenceApps.ts`.

## Limitations and residual risks

- The browser reference targets Ethereum Sepolia chain ID `11155111` and the
  escrow and token addresses supplied for this project. This workspace has
  not independently verified those deployments on-chain; runtime bytecode and
  decimals checks are configuration checks, not source verification or an
  audit. Hardhat Local chain ID `31337` remains the test environment. `mUSDC`
  is a six-decimal mock token, not USDC.
- No NFT, rebase-token, fee-on-transfer, or arbitrary digital-asset support is
  claimed. Exact-delta checks reject fee-on-transfer behavior but cannot make
  a malicious token trustworthy.
- The arbitrator is a single immutable EOA chosen at deployment; no rotation,
  multisig governance, or DAO process is implemented.
- A transaction can be pending, replaced, dropped, reverted, or reorganized.
  Applications must handle confirmation/finality according to the target
  network and their own risk policy.
- Signed agreement nonce consumption is per buyer. Parties should verify the
  agreement terms and avoid signing unexpected messages.
- MCP write-tool enablement is consequential. Keep RPC credentials and
  private keys in protected local configuration, use a dedicated low-value
  development signer locally, and do not place secrets in source control.
- No static analyzer result or professional audit is available. Do not use
  real funds or claim production readiness based solely on these tests.

## Supported and unsupported functionality

**Implemented and tested locally:** ETH escrow; arbitrator-allowlisted
ERC-20 escrow; two-party and explicit-threshold multi-party approval;
pre-funding cancellation; undelivered-expiry refund; sequential milestones;
party disputes and arbitrator settlement; EIP-712 signed agreement creation;
SDK and MCP access; CLI reference flows; a documentation website with
Freelance Escrow and P2P Escrow browser reference integrations. Browser-wallet
transaction flows are not verified here.

**Not implemented or not verified:** NFT/digital assets; verified Base or
other public-chain deployments; real USDC configuration; public-chain
finality policy; professional security audit; end-to-end browser transactions
using an injected wallet.
