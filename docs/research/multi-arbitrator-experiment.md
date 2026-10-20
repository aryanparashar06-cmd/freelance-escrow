# Multi-Arbitrator Escrow Experiment

This document records an experimental comparison between the existing `FreelanceEscrow` contract (V1) and a separate `FreelanceEscrowV2` design. V1 remains the working baseline. V2 is an isolated research contract and is not integrated into the user-facing application.

## 1. Problem statement

V1 assigns one arbitrator to each escrow job. If a client or freelancer raises a dispute after work is submitted, that one address decides whether the escrow is refunded to the client or released to the freelancer. This is simple and relatively inexpensive, but it creates a single decision point: one unavailable, compromised, bribed, or biased arbitrator can determine the outcome or prevent settlement.

The experiment asks whether a fixed committee of three job-specific arbitrators, with two matching votes required to settle a dispute, can reduce reliance on one arbitrator while preserving the existing escrow lifecycle and fixed payout recipients. It also measures the extra execution cost and identifies the trust and liveness problems that voting does not solve.

## 2. Original single-arbitrator architecture

In V1, a client creates and funds a job, names a freelancer and one arbitrator, and sets a deadline. The normal lifecycle is:

`FUNDED -> ACCEPTED -> SUBMITTED -> RELEASED`

The client can approve submitted work and release payment. If no work is submitted by the deadline, the client can reclaim the escrow from a `FUNDED` or `ACCEPTED` job. If submitted work remains undisputed and unapproved beyond the three-day review period, the freelancer can claim payment. Either party may instead move a `SUBMITTED` job into `DISPUTED`. The single designated arbitrator then chooses one of two fixed outcomes:

- `REFUND`: return the entire escrow amount to the registered client.
- `RELEASE`: send the entire escrow amount to the registered freelancer.

The arbitrator cannot nominate another recipient or split the payment. Contract state checks, role checks, checks-effects-interactions, and `ReentrancyGuard` protect the settlement paths. The design still trusts one arbitrator to act correctly and promptly after a dispute.

## 3. Proposed 2-of-3 model

V2 preserves the normal job states and timeout paths but assigns exactly three distinct arbitrator addresses to every job. Each arbitrator must be nonzero and different from the client, freelancer, and the other two arbitrators. The contract rejects an invalid committee when the job is created.

The client or freelancer may open a dispute only while the job is `SUBMITTED` and no later than `submittedAt + REVIEW_PERIOD`; the exact expiry timestamp is included. Once a job reaches `DISPUTED`, resolution has no review-period deadline. A designated arbitrator may vote exactly once for `REFUND` or `RELEASE`. One vote records an opinion but does not transfer funds. Two matching votes form a quorum and immediately finalize the job:

- Two `REFUND` votes set the state to `REFUNDED` and pay the registered client.
- Two `RELEASE` votes set the state to `RELEASED` and pay the registered freelancer.

A conflicting first pair, one vote for each outcome, does not settle the job. The third arbitrator can then create a two-vote majority. No voter supplies a recipient address. Vote records and counts belong to a particular job, so activity on one escrow cannot contribute to another escrow's quorum. The anticipated external interface uses a committee in `createJob`, exposes committee and vote-count reads, and accepts only the two enum decisions through a dispute-vote function; the compiled contract ABI is the authoritative interface.

## 4. Trust assumptions

The contract assumes that the client selects three usable Ethereum addresses and that at least two arbitrators will review the dispute, remain available, protect their keys, and vote independently enough to reach a justified result. The contract can verify addresses and votes, but it cannot verify an arbitrator's identity, expertise, neutrality, or off-chain review process.

The model also assumes that the client and freelancer can inspect the committee before accepting the arrangement. Distinct addresses do not prove distinct human controllers: one person may control several keys. A 2-of-3 threshold therefore distributes on-chain authority across addresses without proving independent governance.

The Ethereum execution environment is trusted to enforce contract bytecode and transaction ordering. Users must interact with the intended contract and network. Submitted work proof remains an arbitrary string reference; the contract does not establish the correctness, availability, confidentiality, or authorship of the referenced work.

## 5. Threat model

The experiment considers accidental misuse and adversarial calls from clients, freelancers, committee members, unrelated accounts, and receiving contracts.

- **Unauthorized voting:** an unrelated address, client, or freelancer may try to affect a vote count. Membership checks must reject the call unless the same address was validly designated as an arbitrator; creation rules prevent the client and freelancer from joining the committee.
- **Repeated voting:** a committee member may try to vote twice or switch decisions. A per-job, per-address record must allow only the first valid vote.
- **Post-resolution voting and double payout:** callers may try to vote or settle again after a quorum. The state must leave `DISPUTED` before the external transfer, and later settlement attempts must fail.
- **Cross-job manipulation:** a vote on one job may be replayed or accidentally counted on another. All voter records and counts must be keyed by job ID.
- **Reentrancy:** a recipient contract may call back during a release or refund. Settlement functions use checks-effects-interactions and `nonReentrant`; a failed or malicious callback must not create a second payment.
- **Failed transfers:** a recipient may reject ETH. The complete transaction, including the decisive vote and state update, must revert atomically so accounting does not show a settlement that was not paid.
- **Collusion and bribery:** any two arbitrators can coordinate, be bribed, or share one controller and select either permitted outcome. The threshold raises the number of approving keys from one to two; it does not prevent collusion.
- **Biased committee selection:** a client who chooses friendly or related arbitrators may bias dispute resolution. Address validation does not establish neutrality.
- **Inactivity and disagreement:** an arbitrator may disappear, and the committee may fail to produce two matching votes. With three valid votes, one outcome necessarily reaches two votes, but one or more abstentions can leave the funds locked indefinitely.
- **Key compromise and transaction ordering:** stolen arbitrator keys can cast valid on-chain votes, and the order of votes may affect which transfer is attempted first. A two-vote quorum still controls the outcome.

## 6. Security properties

The V2 implementation is intended to enforce these properties:

1. A job contains exactly three valid, pairwise-distinct arbitrators who are not its client or freelancer.
2. Only the assigned freelancer can accept a funded job and submit nonempty work proof before the deadline.
3. Only the client or freelancer can raise a dispute, only while the job is `SUBMITTED`, and only through the exact review-period expiry timestamp. Existing disputes remain resolvable afterward.
4. Only a designated arbitrator can vote on that job, only while it is `DISPUTED`, and only once.
5. Only `REFUND` and `RELEASE` are valid vote values.
6. One vote cannot settle or transfer escrow; two matching votes are necessary and sufficient.
7. A refund can pay only the stored client, and a release can pay only the stored freelancer.
8. State changes precede external settlement calls, and reentrancy protection covers every ETH-transfer path.
9. A failed ETH transfer reverts the entire transaction, including vote and state changes.
10. A terminal job cannot be paid twice or receive more dispute votes.
11. Deadline refunds remain restricted to expired `FUNDED` or `ACCEPTED` jobs.
12. Review-timeout claims remain restricted to `SUBMITTED` jobs after `submittedAt + REVIEW_PERIOD`; entering `DISPUTED` disables that path.
13. Job balances, committee membership, vote records, and state transitions remain independent across job IDs.

These are contract-level safety goals. They do not establish that a decision is factually correct or fair.

## 7. Test methodology

V2 is tested in a separate Hardhat suite so the existing V1 test suite and production contract remain unchanged. Tests use fresh local deployments, known signers, and receipt/state/balance assertions. They cover valid creation; invalid, duplicate, and role-conflicting committee addresses; unauthorized, duplicate, invalid, and post-resolution votes; one-vote and conflicting-vote intermediate states; both two-vote outcomes; exact and expired review-period boundaries; resolution of an existing dispute after expiry; deadline refunds; review-timeout claims; dispute blocking of the timeout path; job isolation; and terminal-state double-payout prevention.

Adversarial receiver contracts exercise reentrant callbacks and rejected ETH transfers. Atomicity tests verify that a failed payout does not leave a terminal state or decisive vote recorded. Balance-conservation checks compare the contract's funded liabilities and recipient transfers while excluding transaction gas paid by senders. Where practical, repeated cases vary committee order, voter order, job ID, and decision sequence to provide invariant-style coverage without treating redundant assertions as additional security evidence.

The final validation runs the complete existing V1 suite as well as the separate V2 suite. A passing suite demonstrates agreement with the encoded scenarios; it is not a formal proof and does not replace independent review.

## 8. Gas benchmarking methodology

The reproducible Hardhat benchmark deploys V1 and V2 on the same ephemeral local network with the repository's compiler and optimizer configuration. It uses comparable title and work-proof lengths, escrow values, deadlines, signer roles, and state transitions. Every number comes from the `gasUsed` field of a confirmed transaction receipt; estimates are not reported as measurements.

The benchmark measures job creation, acceptance, work submission, dispute creation, client approval, deadline refund, and review-timeout claim for both versions where applicable. It separately records V1's one-transaction dispute resolution and V2's first vote plus decisive second vote. The complete disputed-workflow totals include every transaction from creation through settlement:

- V1 total: create + accept + submit + raise dispute + resolve dispute.
- V2 total: create + accept + submit + raise dispute + first vote + decisive second vote.

This avoids comparing V1's full resolution with only one part of V2's resolution. Local-network gas use supports implementation comparison, not a fiat cost prediction. Fiat cost would additionally depend on the chosen chain, gas price, and asset price.

## 9. Measured results

The benchmark was executed against the compiled V1 and V2 contracts. The values below are actual `gasUsed` values from confirmed transaction receipts, measured in gas units.

| Operation | V1 gas used | V2 gas used | V2 - V1 | Notes |
| --- | ---: | ---: | ---: | --- |
| Create job | 234,101 | 278,913 | +44,812 | V2 stores three committee addresses and initializes committee metadata. |
| Accept job | 33,057 | 33,146 | +89 | Comparable lifecycle transition. |
| Submit work | 80,471 | 80,427 | -44 | Same proof string length. |
| Raise dispute | 30,967 | 33,328 | +2,361 | V2 also enforces the review-period boundary. |
| V1 single-arbitrator RELEASE resolution | 49,574 | Not applicable | Not applicable | One V1 transaction both decides and pays. |
| V2 first RELEASE vote | Not applicable | 82,130 | Not applicable | Records one vote; it cannot finalize or transfer escrow. |
| V2 second RELEASE vote and final payout | Not applicable | 101,101 | Not applicable | Records the matching vote, finalizes, and pays the freelancer. |
| Complete dispute-resolution stage | 49,574 | 183,231 | +133,657 | Compares V1's one resolution transaction with both required V2 vote transactions. |
| Client approval | 48,490 | 48,535 | +45 | Non-disputed release path. |
| Deadline refund | 45,608 | 45,653 | +45 | Expired unsubmitted job. |
| Review-timeout claim | 45,757 | 45,780 | +23 | Submitted, undisputed job after review period. |
| Complete disputed workflow | 428,170 | 609,045 | +180,875 | Includes every transaction listed in Section 8. |

The complete disputed workflow used 180,875 more gas in V2, a **42.24% overhead** relative to V1. The largest direct additions were V2's larger job-creation storage cost and its requirement for two on-chain voting transactions. The resolution-stage comparison uses both V2 votes (183,231 gas total), rather than presenting only the first or decisive vote against V1's single 49,574-gas resolution transaction.

## 10. Security-versus-cost trade-offs

V1 minimizes coordination and transaction count: one arbitrator can resolve a dispute in one transaction. Its failure domain is correspondingly narrow because that one key can unilaterally select the result.

V2 requires agreement from two designated addresses. A single malicious or compromised arbitrator cannot independently transfer escrow, and one unavailable arbitrator does not block settlement if the other two agree. These benefits require more storage at creation, per-arbitrator vote tracking, vote-count updates, and at least two resolution transactions from two accounts. The decisive transfer therefore occurs only after users collectively pay for an additional transaction, and operational coordination is more complex.

The model changes the trust threshold; it does not remove trust. Its value depends on whether the committee members are actually independent and whether the increased cost and slower resolution are acceptable for the escrow amount and dispute risk.

## 11. Remaining weaknesses

- Two colluding, bribed, compromised, or commonly controlled arbitrators can select either outcome.
- The client can bias committee selection unless the parties use an external selection or acceptance process.
- Address uniqueness does not provide identity uniqueness, reputation, competence, or independence.
- If no two arbitrators submit matching votes, funds remain locked. The contract intentionally has no arbitrary dispute-timeout payout because such a rule could override a genuine unresolved dispute.
- The contract does not verify work quality, interpret the proof, guarantee off-chain data availability, or protect public proof references from disclosure.
- A recipient that cannot receive ETH can prevent the corresponding settlement transfer. Atomic reversion preserves accounting but does not restore liveness.
- Fixed all-or-nothing outcomes do not support milestones, partial awards, fee allocation, appeals, replacement arbitrators, recusals, or emergency recovery.
- Public votes expose each arbitrator's decision and may enable pressure, retaliation, or bribery.
- Local tests and gas measurements cannot reproduce every production-chain condition or establish freedom from implementation defects.

## 12. Opportunities for future research

Future experiments could compare client-selected committees with verifiable random selection, bonded arbitrator registries, reputation systems, or party-approved committee formation. Any such mechanism should evaluate Sybil resistance, bribery incentives, selection bias, privacy, governance capture, and the cost of verifying eligibility on-chain.

Liveness research could examine carefully constrained arbitrator replacement, appeals, or escalation to a larger committee without silently awarding funds to one party. Commit-reveal voting may reduce observation of earlier votes, although it adds transactions and creates its own non-reveal problem. Threshold signatures could reduce on-chain transaction count after off-chain coordination, but they move complexity into key management and signature collection.

Further engineering work could add formal state-transition specifications, fuzzing and invariant tests over multiple simultaneous jobs, static analysis, independent audit, and benchmarks across optimizer settings and target networks. Work-proof research should separately address content availability, integrity, access control, and privacy. V2 should be considered for frontend integration only after its ABI, tests, measured costs, and security review are complete.
