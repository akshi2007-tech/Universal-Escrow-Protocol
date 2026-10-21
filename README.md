# Universal Escrow Protocol

**Reusable, developer-first escrow infrastructure for EVM applications.**

Universal Escrow Protocol provides reusable Solidity escrow contracts, a TypeScript SDK, and an MCP server that enable developers to integrate escrow functionality into applications such as freelance marketplaces, peer-to-peer transactions, and service platforms.

**Live Demo:** [Railway Deployment](https://universal-escrow-protocol-production.up.railway.app/)

---

## Overview

Escrow systems help participants exchange assets under predefined conditions. Universal Escrow Protocol provides building blocks for developers who want to integrate escrow into their own applications instead of implementing escrow logic from scratch.

The project includes:

- Solidity smart contracts for escrow workflows.
- Support for ETH and allowlisted ERC-20 tokens.
- A TypeScript SDK for programmatic integration.
- An MCP server exposing escrow operations to compatible AI applications.
- Browser-based reference applications for freelance and P2P escrow.
- Documentation covering architecture, workflows, integration, and security considerations.

## Key Features

- **Reusable smart contracts:** Integrate escrow logic into different EVM applications.
- **Multi-party workflows:** Support participants, approvals, and conditional asset release.
- **ETH and ERC-20 support:** Handle native ETH and supported ERC-20 tokens.
- **Milestone-based payments:** Organize payments around defined milestones.
- **Release and refund:** Support escrow completion and eligible refund workflows.
- **Expiry handling:** Include deadline-based escrow behavior.
- **Dispute management:** Provide dispute and resolution workflows.
- **Typed SDK:** Interact with escrow operations through TypeScript.
- **MCP integration:** Expose escrow tools to compatible MCP clients.
- **Reference applications:** Demonstrate freelance and P2P escrow use cases.

## Architecture

The protocol is organized into four main layers:

1. **Smart Contracts** — On-chain escrow logic, asset handling, and state transitions.
2. **TypeScript SDK** — Developer-friendly methods for interacting with the contracts.
3. **MCP Server** — Tool interfaces for compatible AI applications.
4. **Reference Applications and Documentation** — Browser demos, CLI examples, and developer guides.

```text
Applications
     |
     v
TypeScript SDK ------ MCP Server
     |                    |
     v                    v
        Escrow Smart Contracts
                  |
                  v
          Ethereum / EVM Network
```

## Network Deployments

### Ethereum Sepolia Testnet

The project includes escrow and mock ERC-20 token deployments on Ethereum Sepolia.

| Detail | Value |
|---|---|
| Network | Ethereum Sepolia |
| Chain ID | `11155111` |
| Escrow Contract | `0x8BFF30EcA3b4FF87d269B086525161ab334F04b7` |
| Mock ERC-20 (mUSDC) | `0xE52bFe7d7e08Fe268a6413f77676c96a17577fcb` |

**Contract links:**

- [Escrow Contract on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x8BFF30EcA3b4FF87d269B086525161ab334F04b7)
- [Mock ERC-20 Token on Sepolia Etherscan](https://sepolia.etherscan.io/address/0xE52bFe7d7e08Fe268a6413f77676c96a17577fcb)

The mock token is intended for testing and is not real USDC. Sepolia uses test ETH and test tokens with no intended real-world monetary value.

## Tech Stack

- **Smart Contracts:** Solidity
- **Development Framework:** Hardhat
- **Programming Language:** TypeScript
- **SDK:** Ethers.js
- **Frontend:** Vite and TypeScript
- **Blockchain:** Ethereum Sepolia and local Hardhat network
- **AI Integration:** Model Context Protocol (MCP)
- **Deployment:** Railway

## Project Structure

```text
Universal-Escrow-Protocol/
├── contracts/          # Solidity escrow contracts
├── test/               # Smart contract tests
├── sdk/                # TypeScript SDK
├── mcp/                # MCP server and tools
├── web/                # Browser interface and documentation site
├── apps/
│   ├── freelance/      # Freelance escrow reference application
│   └── p2p/            # Peer-to-peer escrow reference application
├── docs/               # Architecture and security documentation
├── scripts/            # Development and deployment scripts
├── ignition/           # Hardhat deployment modules
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js and npm
- Git
- A Web3 wallet, such as MetaMask, for browser-based Sepolia interactions
- Sepolia test ETH for testnet transactions

### Installation

Clone the repository and install its dependencies:

```bash
git clone https://github.com/akshi2007-tech/Universal-Escrow-Protocol.git
cd Universal-Escrow-Protocol
npm install
```

### Build the Project

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Run the Documentation Site Locally

```bash
npm run dev:docs
```

Open the local URL printed by Vite in your terminal.

### Run the Reference Applications

The reference demos use the local Hardhat development environment.

Freelance escrow:

```bash
npm run demo:freelance
```

P2P escrow:

```bash
npm run demo:p2p
```

Consult the relevant application documentation and scripts for additional setup requirements.

## Browser Configuration

The browser application uses Vite environment variables for its network configuration.

Configure the following variables in your local environment file, such as `.env.local`, using the deployed addresses above:

```env
VITE_ESCROW_CONTRACT_ADDRESS=your_escrow_contract_address
VITE_MUSDC_ADDRESS=your_mock_token_address
VITE_ESCROW_RPC_URL=your_sepolia_rpc_url
```

Replace the example values with your actual configuration.

**Never put private keys, seed phrases, or wallet secrets in Vite environment variables.** Variables prefixed with `VITE_` can be exposed to browser users.

## TypeScript SDK

The SDK provides a programmatic interface for common escrow operations, including:

- Creating an escrow.
- Funding an escrow.
- Releasing or refunding funds when permitted.
- Raising and resolving disputes.
- Retrieving escrow details and status.
- Accessing transaction information and decoded events.

Refer to the SDK source and project documentation for the exact method signatures, configuration options, and usage examples.

## MCP Server

The MCP server exposes escrow functionality through tools designed for compatible MCP clients.

The available tool set includes:

- `create_escrow`
- `get_escrow`
- `fund_escrow`
- `release_escrow`
- `refund_escrow`
- `raise_dispute`
- `resolve_dispute`
- `get_transaction`

Write operations can move assets or change on-chain state. Review the transaction details and permissions before authorizing any operation.

## Reference Applications

### Freelance Escrow

Demonstrates how escrow infrastructure can support payments between clients and freelancers, with funds governed by the protocol's configured conditions.

### P2P Escrow

Demonstrates how escrow can facilitate peer-to-peer transactions between participants.

These applications are reference implementations intended to illustrate integration patterns. They are not a claim that every possible marketplace workflow has been production-hardened.

## Documentation

The repository includes documentation covering:

- Protocol architecture and escrow lifecycle.
- Core concepts and contract behavior.
- SDK and MCP integration.
- Network and token configuration.
- Reference application workflows.
- Security considerations and threat modeling.

Explore the `docs/` directory and the live project site for implementation details.

## Security Considerations

Smart contracts that hold assets require careful testing and review.

- Use test networks while developing and experimenting.
- Verify contract addresses and network IDs before transactions.
- Review token approvals and transaction details before signing.
- Treat dispute resolution and administrative permissions as security-critical.
- Do not assume that passing tests guarantees the absence of vulnerabilities.
- Obtain an independent security audit before considering real-value production use.

**This project is not presented as independently audited or production-ready for real funds.**

## Limitations

- The published testnet deployment is for experimentation, not real-value transactions.
- The mock mUSDC token is not an official USDC deployment.
- NFT escrow support is not currently claimed.
- SDK publication to a public package registry is not claimed unless separately released.
- Browser interactions should be tested end to end with a connected wallet before relying on them.

## Contributing

Contributions, bug reports, and suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and add relevant tests.
4. Run the available build and test commands.
5. Submit a pull request describing your changes.

## Disclaimer

Universal Escrow Protocol is a software development project intended for experimentation, education, and integration research. Blockchain transactions may be irreversible. Review the source code, configuration, and security assumptions before using the protocol.

## License

See the repository's `LICENSE` file for the applicable license terms.

