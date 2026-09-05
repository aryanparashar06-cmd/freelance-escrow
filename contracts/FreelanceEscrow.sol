// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FreelanceEscrow is ReentrancyGuard {

    // =================================================
    // JOB STATES
    // =================================================

    enum JobState {
        NONE,
        FUNDED,
        ACCEPTED,
        SUBMITTED,
        DISPUTED,
        RELEASED,
        REFUNDED
    }

    // Arbitrator can only choose one of these outcomes.
    enum DisputeDecision {
        NONE,
        REFUND,
        RELEASE
    }


    // =================================================
    // JOB STRUCTURE
    // =================================================

    struct Job {
        address payable client;
        address payable freelancer;
        address arbitrator;

        uint256 amount;
        string title;

        uint256 deadline;
        uint256 createdAt;
        uint256 submittedAt;

        string workProof;

        JobState state;
    }


    // =================================================
    // STORAGE
    // =================================================

    uint256 public jobCount;

    // Client gets 3 days to approve or dispute
    // after the freelancer submits work.
    uint256 public constant REVIEW_PERIOD = 3 days;

    mapping(uint256 => Job) public jobs;


    // =================================================
    // EVENTS
    // =================================================

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed freelancer,
        address arbitrator,
        uint256 amount,
        uint256 deadline,
        string title
    );

    event JobAccepted(
        uint256 indexed jobId,
        address indexed freelancer
    );

    event WorkSubmitted(
        uint256 indexed jobId,
        address indexed freelancer,
        string workProof,
        uint256 submittedAt
    );

    event PaymentReleased(
        uint256 indexed jobId,
        address indexed client,
        address indexed freelancer,
        uint256 amount
    );

    event RefundIssued(
        uint256 indexed jobId,
        address indexed client,
        uint256 amount
    );

    event DisputeRaised(
        uint256 indexed jobId,
        address indexed raisedBy
    );

    event DisputeResolved(
        uint256 indexed jobId,
        address indexed arbitrator,
        DisputeDecision decision,
        address recipient,
        uint256 amount
    );

    event ReviewTimeoutClaimed(
        uint256 indexed jobId,
        address indexed freelancer,
        uint256 amount
    );


    // =================================================
    // CREATE JOB
    // =================================================

    function createJob(
        string calldata _title,
        address payable _freelancer,
        address _arbitrator,
        uint256 _deadline
    ) external payable returns (uint256) {

        require(
            bytes(_title).length > 0,
            "Title cannot be empty"
        );

        require(
            _freelancer != address(0),
            "Invalid freelancer"
        );

        require(
            _arbitrator != address(0),
            "Invalid arbitrator"
        );

        require(
            msg.value > 0,
            "Payment must be greater than zero"
        );

        require(
            _deadline > block.timestamp,
            "Deadline must be in future"
        );

        require(
            _freelancer != msg.sender,
            "Client cannot be freelancer"
        );

        require(
            _arbitrator != msg.sender,
            "Client cannot be arbitrator"
        );

        require(
            _arbitrator != _freelancer,
            "Arbitrator cannot be freelancer"
        );

        jobCount++;

        uint256 newJobId = jobCount;

        jobs[newJobId] = Job({
            client: payable(msg.sender),
            freelancer: _freelancer,
            arbitrator: _arbitrator,
            amount: msg.value,
            title: _title,
            deadline: _deadline,
            createdAt: block.timestamp,
            submittedAt: 0,
            workProof: "",
            state: JobState.FUNDED
        });

        emit JobCreated(
            newJobId,
            msg.sender,
            _freelancer,
            _arbitrator,
            msg.value,
            _deadline,
            _title
        );

        return newJobId;
    }


    // =================================================
    // ACCEPT JOB
    // =================================================

    function acceptJob(
        uint256 _jobId
    ) external {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.freelancer,
            "Only freelancer can accept"
        );

        require(
            job.state == JobState.FUNDED,
            "Job is not funded"
        );

        require(
            block.timestamp < job.deadline,
            "Deadline has passed"
        );

        job.state = JobState.ACCEPTED;

        emit JobAccepted(
            _jobId,
            msg.sender
        );
    }


    // =================================================
    // SUBMIT WORK
    // =================================================

    function submitWork(
        uint256 _jobId,
        string calldata _workProof
    ) external {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.freelancer,
            "Only freelancer can submit"
        );

        require(
            job.state == JobState.ACCEPTED,
            "Job is not accepted"
        );

        require(
            block.timestamp <= job.deadline,
            "Deadline has passed"
        );

        require(
            bytes(_workProof).length > 0,
            "Work proof cannot be empty"
        );

        job.workProof = _workProof;
        job.submittedAt = block.timestamp;
        job.state = JobState.SUBMITTED;

        emit WorkSubmitted(
            _jobId,
            msg.sender,
            _workProof,
            block.timestamp
        );
    }


    // =================================================
    // CLIENT APPROVES WORK
    // =================================================

    function approveWork(
        uint256 _jobId
    ) external nonReentrant {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.client,
            "Only client can approve"
        );

        require(
            job.state == JobState.SUBMITTED,
            "Work is not submitted"
        );

        uint256 paymentAmount = job.amount;

        // EFFECT
        job.state = JobState.RELEASED;

        // INTERACTION
        (bool success, ) = job.freelancer.call{
            value: paymentAmount
        }("");

        require(
            success,
            "Payment transfer failed"
        );

        emit PaymentReleased(
            _jobId,
            msg.sender,
            job.freelancer,
            paymentAmount
        );
    }


    // =================================================
    // DEADLINE REFUND
    // =================================================

    function refundAfterDeadline(
        uint256 _jobId
    ) external nonReentrant {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.client,
            "Only client can request refund"
        );

        require(
            block.timestamp > job.deadline,
            "Deadline has not passed"
        );

        /*
         * Refund is allowed only if work
         * has NOT been submitted.
         */
        require(
            job.state == JobState.FUNDED ||
            job.state == JobState.ACCEPTED,
            "Refund not allowed"
        );

        uint256 refundAmount = job.amount;

        // EFFECT
        job.state = JobState.REFUNDED;

        // INTERACTION
        (bool success, ) = job.client.call{
            value: refundAmount
        }("");

        require(
            success,
            "Refund transfer failed"
        );

        emit RefundIssued(
            _jobId,
            msg.sender,
            refundAmount
        );
    }


    // =================================================
    // RAISE DISPUTE
    // =================================================

    function raiseDispute(
        uint256 _jobId
    ) external {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.client ||
            msg.sender == job.freelancer,
            "Only client or freelancer can dispute"
        );

        /*
         * MVP rule:
         * Disputes are allowed after work submission.
         *
         * If no work is submitted before deadline,
         * the client already has the deadline-refund path.
         */
        require(
            job.state == JobState.SUBMITTED,
            "Dispute not allowed"
        );

        job.state = JobState.DISPUTED;

        emit DisputeRaised(
            _jobId,
            msg.sender
        );
    }


    // =================================================
    // ARBITRATOR RESOLVES DISPUTE
    // =================================================

    function resolveDispute(
        uint256 _jobId,
        DisputeDecision _decision
    ) external nonReentrant {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.arbitrator,
            "Only arbitrator can resolve"
        );

        require(
            job.state == JobState.DISPUTED,
            "Job is not disputed"
        );

        require(
            _decision == DisputeDecision.REFUND ||
            _decision == DisputeDecision.RELEASE,
            "Invalid decision"
        );

        uint256 amount = job.amount;

        address payable recipient;

        // ---------------------------------------------
        // REFUND
        // ---------------------------------------------

        if (_decision == DisputeDecision.REFUND) {

            /*
             * Arbitrator does NOT choose a wallet.
             * Refund always goes to registered client.
             */

            recipient = job.client;

            // EFFECT
            job.state = JobState.REFUNDED;
        }

        // ---------------------------------------------
        // RELEASE
        // ---------------------------------------------

        else {

            /*
             * Release always goes to the
             * registered freelancer.
             */

            recipient = job.freelancer;

            // EFFECT
            job.state = JobState.RELEASED;
        }

        // INTERACTION
        (bool success, ) = recipient.call{
            value: amount
        }("");

        require(
            success,
            "Transfer failed"
        );

        emit DisputeResolved(
            _jobId,
            msg.sender,
            _decision,
            recipient,
            amount
        );
    }


    // =================================================
    // FREELANCER CLAIM AFTER CLIENT INACTIVITY
    // =================================================

    function claimAfterReviewTimeout(
        uint256 _jobId
    ) external nonReentrant {

        Job storage job = jobs[_jobId];

        require(
            job.state != JobState.NONE,
            "Job does not exist"
        );

        require(
            msg.sender == job.freelancer,
            "Only freelancer can claim"
        );

        /*
         * Must still be SUBMITTED.
         *
         * This prevents timeout claims after:
         * - payment release
         * - refund
         * - dispute creation
         */
        require(
            job.state == JobState.SUBMITTED,
            "Work is not submitted"
        );

        /*
         * Client gets a fixed review window
         * after submission.
         */
        require(
            block.timestamp >
                job.submittedAt + REVIEW_PERIOD,
            "Review period has not passed"
        );

        uint256 amount = job.amount;

        // EFFECT
        job.state = JobState.RELEASED;

        // INTERACTION
        (bool success, ) = job.freelancer.call{
            value: amount
        }("");

        require(
            success,
            "Payment transfer failed"
        );

        emit ReviewTimeoutClaimed(
            _jobId,
            msg.sender,
            amount
        );
    }
}