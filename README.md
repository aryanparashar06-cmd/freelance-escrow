# Decentralized Blockchain-Based Escrow System for Secure Freelance Transactions

A university project that demonstrates how a Solidity smart contract can hold freelance payments, enforce a clear job lifecycle, and provide defined remedies for disputes, missed delivery, and client inactivity. The React application connects through MetaMask and presents every contract action in a role-aware black-and-gold interface.

The project currently uses one designated arbitrator per job. It is not presented as fully trustless arbitration, a professional security audit, or a guarantee of complete security.

## Purpose

Traditional freelance payments require one party to trust the other or rely on a centralized platform. This project places the payment in a smart-contract escrow when the client creates a job. The contract then releases or refunds that payment only through its permitted state transitions.

## Architecture

```text
React + Vite frontend
        ├── Ethers.js v6 / MetaMask ──► FreelanceEscrow.sol
        │                                  │
        │                                  ▼
        │                    Hardhat Local or Ethereum Sepolia
        │
        └── wallet-signed challenge ──► secure upload service
                                             │ one-use upload token
                                             ▼
                                private temporary quarantine
                                             │
                         signature check + SHA-256 + ClamAV scan
                                             │ clean only
                                             ▼
                              server-side Pinata/IPFS upload
```

The upload service verifies a one-time wallet-signed challenge and the live contract state, then returns an expiring, single-use token for its own upload endpoint. File bytes are streamed into a private temporary quarantine, the server recomputes SHA-256, validates the detected content type, and sends the bytes to a private ClamAV daemon. Only a clean result permits a server-side Pinata upload. The temporary directory is deleted after success or any failure. The Pinata credential stays server-side, and Solidity remains authoritative for the later `submitWork` transaction.

## Technology stack

- Solidity 0.8.28
- OpenZeppelin Contracts 5.x
- Hardhat 3.14
- TypeScript, Mocha, Chai, and Ethers.js for contract tests
- React 19 and Vite 8
- Ethers.js 6.17 in the browser
- MetaMask
- Node.js secure upload service, streaming multipart quarantine, ClamAV, and Pinata v3
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

## Work-proof upload, integrity, and privacy

The contract continues to store one backward-compatible `string workProof`. The Submit Work interface supports ordinary text, URLs, a `sha256:<digest>` reference, a raw IPFS CID, or an `ipfs://` URI without changing that ABI.

- A freelancer may select a supported file and calculate its SHA-256 digest with the browser Web Crypto API. Selection and hashing stay local; upload starts only after a separate button press and public-storage acknowledgement.
- Browser hashing is limited to 50 MB because Web Crypto must read the complete file into memory. Larger files should be hashed independently and their digest pasted into the proof.
- The upload service issues a random, expiring, single-use challenge bound to wallet, job, file name, type, size, checksum, contract, chain, and origin. MetaMask signs this message without creating a transaction. The server verifies the signature and live contract before issuing a second, one-use backend upload token. It never returns a direct Pinata upload URL.
- The backend streams the received bytes to a mode-restricted temporary directory, recomputes SHA-256, verifies the exact signed length and digest, checks the real file signature, rejects active/high-risk formats, and scans content using ClamAV `INSTREAM`. Encrypted archives, exceeded scan limits, scanner errors, and scanner timeouts fail closed.
- Pinata publication begins only after the scanner returns clean. The response contains the validated CID, `ipfs://` URI, original digest, and `no-threats-detected` status. Quarantine files are removed after every outcome.
- A successful upload returns a CID and `ipfs://` URI, but does not call `submitWork`. The freelancer explicitly inserts the URI plus checksum, reviews the proof, and confirms a separate blockchain transaction.
- A SHA-256 digest is an integrity fingerprint. It can help compare bytes later, but it does not encrypt a file or prove quality, authorship, or originality.
- The dashboard renders proof strings as text. Recognized IPFS references receive an optional, user-initiated link through the configured HTTPS gateway; nothing is loaded automatically. If the proof also contains a checksum, the reviewer can select a locally downloaded file and compare its SHA-256 bytes in the browser. A matching digest proves byte integrity, not malware safety. Historical or manually submitted CIDs might never have passed this scanner and are never labelled scanned.
- The user must acknowledge the public-record warning before submission. File bytes are not stored in browser storage or sent to the contract.

Public IPFS files may be accessible to anyone who obtains their CID. Information submitted in a blockchain transaction may also be public and difficult to remove. Do not upload passwords, private keys, personal documents, confidential client information, or sensitive deliverables. This prototype does not encrypt files or provide private key sharing; confidential work needs a separately designed encryption and key-sharing system.

## Gas-cost transparency

Before every write action opens MetaMask, the frontend calls the corresponding Ethers.js v6 `estimateGas` method using the connected signer and provider. It displays:

- the estimated gas limit in gas units;
- the provider's current gas price or EIP-1559 maximum fee per gas in Gwei;
- the resulting estimated network fee in ETH.

The estimate is advisory. Network pricing and final gas usage can change before mining. Escrow value sent by `createJob`, or value released/refunded by the contract, is displayed separately from the network fee.

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

Prerequisites: Node.js compatible with Hardhat 3 and Vite 8, npm, MetaMask, Docker Desktop with Compose, and at least 4 GiB available RAM for ClamAV.

Install the contract and frontend dependencies:

```powershell
cd C:\path\to\freelance-escrow
npm install
cd frontend
npm install
Copy-Item .env.example .env.local
cd ..\upload-service
npm install
Copy-Item .env.example .env
```

The committed frontend defaults match Hardhat Local and the default deployment address used by this project. If a new deployment produces a different address, update `VITE_ESCROW_ADDRESS` in `frontend/.env.local` and restart Vite.

Create a Pinata account and generate a JWT with only the file-write permission needed by the backend. Put it only in `upload-service/.env` as `PINATA_JWT`; never place it in a `VITE_*` variable. Confirm `RPC_URL`, `CHAIN_ID`, and `ESCROW_ADDRESS` match the same deployed contract used by the frontend. When the backend runs in Docker Desktop and Hardhat runs on the host, set `RPC_URL=http://host.docker.internal:8545`.

### Local development workflow

Open four terminals at the repository root. Docker Compose runs the Node upload service and ClamAV together; the scanner is reachable only on their private Compose network.

**Terminal 1 — local blockchain**

```powershell
npx hardhat node
```

**Terminal 2 — deploy to the running local blockchain**

```powershell
npx hardhat run scripts/deploy.ts --network localhost
```

Copy the printed `FreelanceEscrow address` into `frontend/.env.local` when it differs from the configured address.

**Terminal 3 — secure upload backend and scanner**

```powershell
Copy-Item upload-service\.env.example upload-service\.env
# Edit upload-service\.env and set PINATA_JWT, RPC_URL and ESCROW_ADDRESS.
docker compose up --build
```

Wait until `clamav` is healthy. The first start can take several minutes while signature databases initialize. Compose allocates a 4 GiB memory ceiling to ClamAV, persists its signature database, uses a private scanner network, and places quarantine in a 64 MiB temporary filesystem.

**Terminal 4 — frontend**

```powershell
cd frontend
npm run dev
```

Run checks in additional terminals as needed:

```powershell
npx hardhat test
cd frontend
npm run lint
npm run test:unit
npm run build
cd ..\upload-service
npm test
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
VITE_UPLOAD_SERVICE_URL=http://127.0.0.1:8787
VITE_IPFS_GATEWAY_URL=https://ipfs.io/ipfs/
```

All `VITE_*` values are public and embedded in the browser bundle. `VITE_UPLOAD_SERVICE_URL` points to the separately hosted secure upload API, and `VITE_IPFS_GATEWAY_URL` must be an HTTPS gateway base ending in `/ipfs/`. Never put a Pinata JWT, wallet private key, seed phrase, RPC secret, or other credential in a Vite environment variable.

## Upload service configuration

Copy `upload-service/.env.example` to `upload-service/.env`. Its values are server-side:

- `PINATA_JWT` is secret. Generate it in Pinata's API Keys page with only the file-write permission needed by the server-side upload.
- `RPC_URL`, `CHAIN_ID`, and `ESCROW_ADDRESS` identify the exact chain and contract whose jobs authorize uploads. The RPC may itself contain a secret in a hosted deployment.
- `ALLOWED_ORIGINS` is a comma-separated exact allowlist for the Vite development origin and deployed frontend origin. Keep `HOST=127.0.0.1` locally; use the host binding required by the deployment platform, commonly `0.0.0.0`, when hosted. Enable `TRUST_PROXY` only behind a trusted reverse proxy that overwrites `X-Forwarded-For`.
- `UPLOAD_TOKEN_TTL_SECONDS` limits the lifetime of the one-use backend upload token. `QUARANTINE_DIR` must be private and capacity-limited. `CLAMAV_HOST`, `CLAMAV_PORT`, and `CLAMAV_SCAN_TIMEOUT_MS` configure the scanner; never expose ClamAV's unauthenticated TCP port publicly.
- Upload size, MIME allowlist, provider and scanner timeouts, challenge lifetime, and rate limits are configurable. The frontend and service default to 50 MB. Keep `StreamMaxLength` and the quarantine capacity at least as large as that limit.

The service keeps challenges, upload tokens, and rate-limit counters in memory. This is suitable for one instance. A multi-instance deployment needs a shared atomic TTL store such as Redis/KV so replay prevention, token consumption, and rate limiting remain consistent. The public Node service needs HTTPS, a capacity-limited ephemeral quarantine volume, and outbound Pinata/RPC access. ClamAV must run as a separate private service with current FreshClam signatures, at least 3 GiB RAM (4 GiB preferred), bounded concurrency, and no public port.

Operational references: [ClamAV INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [official ClamAV Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html), and [ClamAV scanning guidance](https://docs.clamav.net/manual/Usage/Scanning.html).

### Clean PDF and EICAR checks

For a clean-path manual test, create and accept a job, choose a small ordinary PDF in Submit Work, review the calculated SHA-256, acknowledge public storage, and press **Scan & Upload to IPFS**. The UI should show backend upload, scan, and CID stages. The on-chain transaction remains a separate explicit action.

For the harmless standard EICAR antivirus test, create `eicar.com.txt` only in an isolated development directory, select it through the same accepted job, and verify that the backend returns **Upload rejected: malware was detected by the scanner** and no CID. Delete the test file afterward.

```powershell
Set-Content -Path .\eicar.com.txt -Encoding ascii -NoNewline `
  -Value 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
```

To exercise the automated real-engine test against the Compose scanner:

```powershell
docker compose run --rm -e RUN_CLAMAV_INTEGRATION=true `
  -v "${PWD}/upload-service/test:/app/test:ro" upload-service npm test
```

The real-engine test is opt-in so ordinary unit tests do not pretend that ClamAV ran. Use only EICAR, never actual malware.

### Render deployment feasibility

Render can host this architecture, but it should use two paid services in the same region: a public Docker web service for Node and a Docker private service for ClamAV. Configure `CLAMAV_HOST` with the scanner's internal hostname, give the scanner a 4 GiB compute plan, and attach a persistent disk for `/var/lib/clamav` if signature databases must survive redeploys. Keep quarantine ephemeral and capacity-limited on the Node service. A 512 MB free instance is not enough for ClamAV and must not be used as a reason to skip scanning. Monitor memory, scanner health, signature freshness, latency, quarantine usage, and Pinata failures before public use.

See Render's [private service](https://render.com/docs/private-services), [private network](https://render.com/docs/private-network), [compute plan](https://render.com/docs/compute-plans), and [persistent disk](https://render.com/docs/disks) documentation before provisioning.

## Sepolia readiness

`hardhat.config.ts` already defines a Sepolia HTTP network using the Hardhat configuration variables `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`. The local deployment script remains intentionally local-only in this pass, and nothing is deployed automatically.

Before a future Sepolia deployment:

1. Obtain Sepolia test ETH for the deployment account.
2. Provide `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` through Hardhat's keystore or the deployment environment. Do not commit either value.
3. Use a reviewed Sepolia-capable deployment command/script and record the resulting contract address.
4. Build the frontend with `VITE_CHAIN_ID=11155111`, `VITE_NETWORK_NAME=Sepolia`, and `VITE_ESCROW_ADDRESS` set to that deployed address.
5. Deploy the upload service separately with the same Sepolia chain ID, address, RPC, Pinata JWT, and exact GitHub Pages origin.
6. Point `VITE_UPLOAD_SERVICE_URL` at that HTTPS service and manually retest every lifecycle path.

The React frontend never needs the deployer's private key.

## GitHub Pages hosting plan

Production builds default to the repository base path `/freelance-escrow/`; the Vite development server continues to use `/`. Override `VITE_BASE_PATH` when hosting at a custom path or domain.

To prepare a static bundle:

```powershell
cd frontend
npm run build
```

Publish the generated `frontend/dist` directory with a reviewed GitHub Pages workflow or Pages deployment method. This repository does not auto-publish during the engineering pass. GitHub Pages serves only static files, so it cannot safely hold `PINATA_JWT` or run the secure upload service. The separately hosted HTTPS backend and frontend must use the same public chain and deployed contract.

Pinata plans have finite storage, file-count, bandwidth, and request quotas. At the time of this pass, Pinata advertises a free tier with 1 GB total storage, 500 files, 10 GB monthly bandwidth, and 10,000 monthly requests; confirm current limits and pricing before a demo or deployment. Pinning is a provider service and does not guarantee permanent availability.

## Testing

The Hardhat suite covers creation validation, role restrictions, lifecycle transitions, timing boundaries, dispute outcomes, transfer failures, review-timeout behavior, reentrancy attempts, and event behavior. Run it from the repository root:

```powershell
npx hardhat test
```

Frontend validation commands:

```powershell
cd frontend
npm run lint
npm run test:unit
npm run build
cd ..\upload-service
npm test
```

Contract tests verify Solidity behavior. Manual MetaMask testing is still required for wallet prompts, account switching, network switching, transaction messaging, responsive layout, and each end-to-end user flow.

## Current limitations

- A single designated arbitrator decides disputed jobs.
- Work proof remains a string reference; the contract does not verify the referenced file, authorship, originality, IPFS availability, or content quality.
- The frontend depends on MetaMask or a compatible injected provider.
- There is no indexing service, search, pagination, notification system, or backend history view.
- Contract and frontend upgrades require a new deployment/build; there is no proxy upgrade system.
- Public-testnet operation depends on RPC availability and test ETH.
- Public IPFS provides no confidentiality. The server temporarily receives file bytes in private quarantine, but a passing file is then published publicly. Do not upload secrets or confidential deliverables.
- Content signatures and ClamAV reduce risk but cannot guarantee a file is malware-free. Scanner signatures must stay current, new or targeted malware can be missed, and downloaded files still require cautious handling.
- Encrypted archives, active-content markers, unsupported signatures, and scanner limit alerts are rejected. This intentionally excludes some legitimate files; do not weaken the policy silently.
- The smart contract still accepts arbitrary proof strings and historical/manual CIDs. The application's scanned upload path cannot make those external references trustworthy.
- In-memory challenge, upload-token, and rate-limit state does not coordinate across multiple server instances.
- Gateway and Pinata availability, account quota, retention, and pin management remain external dependencies.

## Future work

- Multi-arbitrator consensus or decentralized dispute resolution
- Encrypted private deliverables with an audited key-sharing design
- Event indexing and job history/search
- Notification support for deadlines and review windows
- Accessibility and broader wallet compatibility testing
- Independent smart-contract audit before any real-value use
