# Decentralized Blockchain-Based Escrow System for Secure Freelance Transactions

A university project that demonstrates how a Solidity smart contract can hold freelance payments, enforce a clear job lifecycle, and provide defined remedies for disputes, missed delivery, and client inactivity. The React application connects through MetaMask and presents every contract action in a role-aware black-and-gold interface.

The project currently uses one designated arbitrator per job. It is not presented as fully trustless arbitration, a professional security audit, or a guarantee of complete security.

## Purpose

Traditional freelance payments require one party to trust the other or rely on a centralized platform. This project places the payment in a smart-contract escrow when the client creates a job. The contract then releases or refunds that payment only through its permitted state transitions.

## Architecture

```text
React + Vite frontend
        │
        │ Ethers.js v6 / MetaMask
        ▼
FreelanceEscrow.sol
        │
        ▼
Hardhat Local (development) or Ethereum Sepolia (future testnet deployment)
```

There is no backend, application database, username/password login, or private key in the frontend. Contract storage is the source of truth. Frontend role and eligibility checks improve usability; Solidity authorization remains authoritative.

## Technology stack

- Solidity 0.8.28
- OpenZeppelin Contracts 5.x
- Hardhat 3.14
- TypeScript, Mocha, Chai, and Ethers.js for contract tests
- React 19 and Vite 8
- Ethers.js 6.17 in the browser
- MetaMask
- CSS-based responsive cinematic interface

## Roles

- **Client:** creates and funds a job, approves submitted work, can raise a dispute, and can refund after a missed deadline when eligible.
- **Freelancer:** accepts the assigned job, submits proof of work, can raise a dispute, and can claim payment after an unanswered review period.
- **Arbitrator:** resolves a disputed job with one of two restricted decisions: refund the registered client or release payment to the registered freelancer.

## State machine

| Value | State | Meaning |
|---:|---|---|
| 0 | `NONE` | No job exists for the ID |
| 1 | `FUNDED` | Client created the job and ETH is locked |
| 2 | `ACCEPTED` | Assigned freelancer accepted before the deadline |
| 3 | `SUBMITTED` | Freelancer submitted work proof |
| 4 | `DISPUTED` | Client or freelancer requested arbitration |
| 5 | `RELEASED` | Terminal state; payment went to the freelancer |
| 6 | `REFUNDED` | Terminal state; payment returned to the client |

```text
Normal:          FUNDED → ACCEPTED → SUBMITTED → RELEASED
Dispute:                           SUBMITTED → DISPUTED → RELEASED / REFUNDED
Missed delivery: FUNDED / ACCEPTED → deadline passes → REFUNDED
Client inactivity:                SUBMITTED → 3-day review timeout → RELEASED
```

The dashboard displays the current state, participant addresses, escrow status, blockchain timestamps, work proof, and all lifecycle paths.

## Contract workflows

### Normal workflow

1. The client creates a job with a title, distinct freelancer and arbitrator addresses, a future deadline, and an ETH payment.
2. The assigned freelancer accepts it before the deadline.
3. The freelancer submits a non-empty proof string before the deadline.
4. The client approves the work and the contract releases the escrowed ETH to the freelancer.

### Dispute workflow

After submission, either the client or freelancer can move the job to `DISPUTED`. The designated arbitrator chooses `REFUND` or `RELEASE`. The arbitrator cannot supply an arbitrary recipient address; the contract always pays the client or freelancer stored in that job.

### Deadline refund

If a job remains `FUNDED` or `ACCEPTED` after its deadline and no work was submitted, the client can call `refundAfterDeadline`. A successful call moves the job to `REFUNDED` and returns the escrow.

### Review-timeout protection

The client has a fixed three-day on-chain review period after submission. If the job remains `SUBMITTED` and the blockchain timestamp becomes strictly greater than `submittedAt + REVIEW_PERIOD`, the assigned freelancer can claim the payment. A disputed job is no longer `SUBMITTED`, so this timeout path is unavailable after a dispute.

## Security model

- OpenZeppelin `ReentrancyGuard` protects functions that transfer ETH.
- Payment functions use the Checks-Effects-Interactions pattern by updating state before the external call.
- Strict state checks prevent invalid lifecycle transitions.
- Role checks bind each action to the client, assigned freelancer, or designated arbitrator.
- Deadlines and the review period use `block.timestamp`.
- `RELEASED` and `REFUNDED` are terminal states under the available functions.
- Arbitration has only two decisions and cannot redirect funds to an arbitrary address.
- Failed ETH transfers revert the complete transaction atomically, including the earlier state update.
- The review timeout protects a freelancer from an indefinitely inactive client.
- The deadline refund protects a client when work is not submitted.

These mechanisms reduce specific risks but do not replace an independent security audit.

## Local setup

Prerequisites: Node.js compatible with Hardhat 3 and Vite 8, npm, and MetaMask.

Install the contract and frontend dependencies:

```powershell
cd C:\path\to\freelance-escrow
npm install
cd frontend
npm install
Copy-Item .env.example .env.local
```

The committed frontend defaults match Hardhat Local and the default deployment address used by this project. If a new deployment produces a different address, update `VITE_ESCROW_ADDRESS` in `frontend/.env.local` and restart Vite.

### Four-terminal development workflow

Open four terminals at the repository root.

**Terminal 1 — local blockchain**

```powershell
npx hardhat node
```

**Terminal 2 — deploy to the running local blockchain**

```powershell
npx hardhat run scripts/deploy.ts --network localhost
```

Copy the printed `FreelanceEscrow address` into `frontend/.env.local` when it differs from the configured address.

**Terminal 3 — frontend**

```powershell
cd frontend
npm run dev
```

**Terminal 4 — contract tests and frontend checks**

```powershell
npx hardhat test
cd frontend
npm run lint
npm run build
```

## MetaMask configuration for Hardhat Local

Add a custom network in MetaMask:

| Setting | Value |
|---|---|
| Network name | Hardhat Localhost |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | ETH |

Use development accounts exposed by the running local node only for local testing. The ETH on this chain is fake test ETH with no real-world value. Never reuse a local development key for a real wallet or public network.

For a complete demonstration, use three separate MetaMask accounts as client, freelancer, and arbitrator. Create a job as the client, switch accounts for each role-specific action, and reload the job in the central dashboard to show the state and escrow status.

## Frontend environment configuration

Vite reads these values from `frontend/.env.local`:

```dotenv
VITE_ESCROW_ADDRESS=0xDeployedContractAddress
VITE_CHAIN_ID=31337
VITE_NETWORK_NAME=Hardhat Localhost
VITE_BASE_PATH=/freelance-escrow/
```

Only public frontend configuration belongs in a `VITE_*` value. Never put a wallet private key, seed phrase, RPC secret, or API secret in a Vite environment variable because Vite embeds those values in the browser bundle.

## Sepolia readiness

`hardhat.config.ts` already defines a Sepolia HTTP network using the Hardhat configuration variables `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`. The local deployment script remains intentionally local-only in this pass, and nothing is deployed automatically.

Before a future Sepolia deployment:

1. Obtain Sepolia test ETH for the deployment account.
2. Provide `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` through Hardhat's keystore or the deployment environment. Do not commit either value.
3. Use a reviewed Sepolia-capable deployment command/script and record the resulting contract address.
4. Build the frontend with `VITE_CHAIN_ID=11155111`, `VITE_NETWORK_NAME=Sepolia`, and `VITE_ESCROW_ADDRESS` set to that deployed address.
5. Add/select Sepolia in MetaMask and manually retest every lifecycle path.

The React frontend never needs the deployer's private key.

## GitHub Pages hosting plan

Production builds default to the repository base path `/freelance-escrow/`; the Vite development server continues to use `/`. Override `VITE_BASE_PATH` when hosting at a custom path or domain.

To prepare a static bundle:

```powershell
cd frontend
npm run build
```

Publish the generated `frontend/dist` directory with a reviewed GitHub Pages workflow or Pages deployment method. This repository does not auto-publish during the engineering pass. GitHub Pages serves only the static frontend, so its configured contract address must point to a publicly reachable chain such as Sepolia rather than a developer's localhost.

## Testing

The Hardhat suite covers creation validation, role restrictions, lifecycle transitions, timing boundaries, dispute outcomes, transfer failures, review-timeout behavior, reentrancy attempts, and event behavior. Run it from the repository root:

```powershell
npx hardhat test
```

Frontend validation commands:

```powershell
cd frontend
npm run lint
npm run build
```

Contract tests verify Solidity behavior. Manual MetaMask testing is still required for wallet prompts, account switching, network switching, transaction messaging, responsive layout, and each end-to-end user flow.

## Current limitations

- A single designated arbitrator decides disputed jobs.
- Work proof is a string reference; the contract does not validate off-chain content.
- The frontend depends on MetaMask or a compatible injected provider.
- There is no indexing service, search, pagination, notification system, or backend history view.
- Contract and frontend upgrades require a new deployment/build; there is no proxy upgrade system.
- Public-testnet operation depends on RPC availability and test ETH.

## Future work

- Multi-arbitrator consensus or decentralized dispute resolution
- Optional IPFS upload and proof metadata validation
- Event indexing and job history/search
- Notification support for deadlines and review windows
- Accessibility and broader wallet compatibility testing
- Independent smart-contract audit before any real-value use
