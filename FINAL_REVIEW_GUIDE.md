# Final Review Guide

## Project in one minute

**Decentralized Blockchain-Based Escrow System for Secure Freelance Transactions** is a B.Tech IDP prototype that holds a client's payment in a Solidity contract and releases or refunds it only through defined, role-protected state transitions.

The client creates and funds a job. The assigned freelancer accepts it, optionally uploads a deliverable through a wallet-authorized malware-scanning service, and stores a proof reference on-chain. The client can approve and release payment or raise a dispute. The designated arbitrator can only refund the recorded client or release to the recorded freelancer. Deadline refund and review-timeout functions protect against non-delivery and client inactivity.

## Architecture to explain

```text
MetaMask + React/Vite
        │
        ├── Ethers.js reads/writes ──► FreelanceEscrow.sol ──► Hardhat Local 31337
        │
        └── signed upload challenge ──► Node upload service
                                              │
                                  one-use backend upload token
                                              │
                                  private temporary quarantine
                                              │
                         exact size + SHA-256 + content validation
                                              │
                                  private ClamAV INSTREAM scan
                                              │ clean only
                                              ▼
                                      Pinata / public IPFS
```

The contract stores the proof string and escrow state. It does not store the file bytes. Pinata stores the uploaded file and returns its CID. SHA-256 lets a reviewer compare downloaded bytes with the recorded digest.

## Exact live-demo sequence

### 1. Start the project

Use four terminals from the repository root.

```powershell
# Terminal 1
npx hardhat node
```

```powershell
# Terminal 2
npx hardhat run scripts/deploy.ts --network localhost
```

Confirm the printed address matches `frontend/.env.local` and `upload-service/.env`. Do not display either environment file during the presentation.

```powershell
# Terminal 3
docker compose up --build
```

Wait until `clamav` is healthy and the upload service reports that it is listening on port 8787.

```powershell
# Terminal 4
cd frontend
npm run dev
```

Open the local Vite URL. Configure MetaMask for `http://127.0.0.1:8545`, chain ID `31337`, and use three separate Hardhat development accounts as client, freelancer, and arbitrator.

### 2. Demonstrate the happy path

1. Select the **client** account and connect MetaMask.
2. Create a job with a future deadline, the freelancer and arbitrator addresses, and a small amount of local test ETH.
3. Approve the transaction. Show that Total Jobs increases and the dashboard state is `FUNDED`.
4. Switch MetaMask to the **freelancer** account. Load the Job ID in **Accept Job** and accept it. Show `ACCEPTED`.
5. In **Submit Work**, load the same job and choose a small, non-sensitive text or PDF file prepared for the demo.
6. Show the locally calculated SHA-256 digest and acknowledge the public-IPFS warning.
7. Click **Scan & Upload to IPFS** and approve the MetaMask message signature. Explain that this signature authorizes the upload and is not a blockchain transaction.
8. Show the quarantine, validation, ClamAV, and IPFS progress states. After success, insert the `ipfs://` URI and checksum into the proof field.
9. Acknowledge the public-blockchain warning and submit work on-chain. Approve the transaction and show `SUBMITTED`.
10. Switch MetaMask to the **client** account. Load the job in the dashboard, inspect the proof, and optionally compare a downloaded local file against the recorded SHA-256.
11. Load the job in **Approve Work**, click **Approve Work & Release Payment**, and approve the transaction.
12. Refresh the dashboard and show `RELEASED` and “Released to freelancer.”

Use only disposable, non-confidential demo content. The upload in step 7 is public and must be deliberately authorized by the presenter.

### 3. Explain alternate paths

Use separate jobs or the automated test output so one terminal state does not prevent another demonstration.

- **Dispute:** From `SUBMITTED`, the client or freelancer raises a dispute. The arbitrator selects exactly `REFUND CLIENT` or `RELEASE TO FREELANCER`. There is no arbitrary recipient field.
- **Deadline refund:** If the state remains `FUNDED` or `ACCEPTED` and blockchain time becomes strictly greater than the deadline, only the client can refund.
- **Review timeout:** If the state remains `SUBMITTED` and blockchain time becomes strictly greater than `submittedAt + 3 days`, only the freelancer can claim payment.
- **Failure safety:** Wrong roles, wrong states, early timeouts, repeated payouts, transfer failures, and reentrancy attempts are demonstrated by the Hardhat suite.

## Security highlights

- Solidity role and state checks remain the authority even when the UI disables an action.
- ETH-transfer functions use OpenZeppelin `ReentrancyGuard` and update state before external calls.
- Transfer failure reverts the entire transaction, including the state update.
- The arbitrator can only choose between the job's stored client and freelancer.
- Upload challenges bind wallet, chain, contract, job, origin, file metadata, size, and SHA-256.
- Challenges and backend upload tokens expire and are single-use. Tokens are stored as hashes.
- The backend rechecks the live job, assigned freelancer, `ACCEPTED` state, and deadline.
- Multipart bytes must exactly match the authorized name, MIME type, size, and SHA-256.
- Files remain in a private, mode-restricted temporary quarantine until content validation and ClamAV complete.
- Scanner errors, timeouts, malformed results, and non-clean results fail closed. Pinata is never called on those paths.
- Temporary quarantine is removed after success or failure.
- The Pinata JWT remains server-side and is never returned to React.
- Unexpected server errors return a correlation ID while logs omit error messages, stacks, query strings, headers, signatures, tokens, and provider response bodies.

## Validated results

Current automated results from **22 October 2026**:

| Validation | Result |
|---|---|
| `npx hardhat test test/FreelanceEscrow.ts` | 74 passing |
| `npx tsc --noEmit` | Passing |
| `cd upload-service; npm test` | 26 passing, 1 opt-in integration test skipped |
| `cd frontend; npm run test:unit` | 20 passing |
| `cd frontend; npm run lint` | Passing |
| `cd frontend; npm run build` | Passing |
| Local RPC read | Chain 31337, deployed bytecode present, contract reads successful |
| Root/frontend production dependency audit | 0 known vulnerabilities reported |

Previously completed live validations:

- A real clean file passed the backend and was uploaded to Pinata successfully.
- The harmless EICAR test signature was rejected by the real ClamAV integration.

Docker Desktop was stopped during the final pass, so the live EICAR integration was not repeated then. No MetaMask transaction or public IPFS upload was performed during the final pass.

## Important limitations

- This is an academic prototype, not an independently audited production escrow.
- One designated arbitrator has full dispute authority.
- A disputed V1 job has no arbitrator timeout; arbitrator inactivity can lock escrow.
- V1 permits a new dispute while a job remains `SUBMITTED`, even after the review period. After timeout, dispute and claim transactions can race until one changes the state.
- Public IPFS provides availability, not confidentiality. The prototype does not encrypt deliverables or distribute decryption keys.
- SHA-256 proves byte equality only. It does not prove authorship, originality, quality, or malware safety.
- ClamAV and file-signature checks reduce risk but cannot guarantee detection of new or targeted malware.
- A manually entered or historical CID may not have passed this upload service.
- Challenge, token, and rate-limit state is in memory and is suitable for one backend instance. Multi-instance deployment needs a shared atomic TTL store.
- There is no event indexer, search, notification service, upgrade proxy, or automatic fund-recovery administrator.
- Pinata, gateway, RPC, wallet, quota, and network availability are external dependencies.

## Likely viva questions

### Why use a smart contract instead of a normal database?

The smart contract holds payment and enforces the same role and state rules for every caller. Neither the frontend nor the upload server can secretly redirect or release escrow. A normal database would require users to trust its operator to apply those rules and control funds correctly.

### Why does `jobCount()` need only a provider while transactions need a signer?

`jobCount()` is a read-only call and changes no blockchain state. A provider can perform it without a wallet signature or gas. Creating, accepting, submitting, approving, disputing, resolving, refunding, and claiming change state, so Ethers.js connects a signer and MetaMask asks the user to approve the transaction.

### Where is the uploaded file stored?

Pinata pins the file on public IPFS. The contract stores only the submitted proof string, normally an `ipfs://` URI plus a SHA-256 digest.

### Does the hash encrypt the file?

No. SHA-256 is a one-way integrity fingerprint. Matching hashes show that two byte sequences are identical, but do not hide the content.

### Why sign an upload challenge?

The signature proves control of the assigned freelancer wallet without exposing its private key. The backend also binds the signature to the exact job and file metadata, verifies current on-chain state, and issues a short-lived one-use token.

### What happens if ClamAV is unavailable?

The upload fails closed with a service error. The backend does not send the file to Pinata.

### Can the arbitrator send money to any address?

No. The arbitrator submits only a decision enum. Solidity selects the recipient already recorded in the job.

### How is reentrancy handled?

Payment functions use `nonReentrant` and Checks-Effects-Interactions. State changes before the external ETH call, and a failed call reverts the whole transaction.

### What prevents duplicate payment?

Successful release or refund moves the job to a terminal state. Later actions fail their state checks. The tests cover repeated payout attempts and balance isolation between jobs.

### How are deadlines evaluated?

Solidity uses `block.timestamp`. The UI reads the latest mined block time for refund and review-timeout eligibility instead of trusting the computer clock.

### What would you improve for production?

Obtain an independent audit, define a dispute timeout or multi-arbitrator process, encrypt confidential files with audited key sharing, add shared replay/rate-limit storage, monitor scanner health and signatures, add event indexing and notifications, and deploy with HTTPS and production operational controls.

## Before presenting

- Run all validation commands again and save the terminal output.
- Confirm Docker Desktop is running and `docker compose ps` reports ClamAV healthy.
- Confirm the local deployment address matches both frontend and upload-service configuration without showing secret files.
- Prepare three clearly named MetaMask development accounts.
- Prepare one small, harmless, non-confidential demo file.
- Reset or redeploy the local chain so Job IDs are predictable.
- Keep the 74-test output ready for alternate paths that are slow to demonstrate live.
- Never display a private key, seed phrase, Pinata JWT, authorization token, or environment-file contents.
