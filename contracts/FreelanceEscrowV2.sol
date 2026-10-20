// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FreelanceEscrowV2
 * @notice Experimental escrow that replaces the single dispute arbitrator with
 *         an immutable three-member committee and a two-matching-vote threshold.
 */
contract FreelanceEscrowV2 is ReentrancyGuard {
    enum JobState {
        NONE,
        FUNDED,
        ACCEPTED,
        SUBMITTED,
        DISPUTED,
        RELEASED,
        REFUNDED
    }

    enum DisputeDecision {
        NONE,
        REFUND,
        RELEASE
    }

    struct Job {
        address payable client;
        address payable freelancer;
        address[3] arbitrators;
        uint256 amount;
        string title;
        uint256 deadline;
        uint256 createdAt;
        uint256 submittedAt;
        string workProof;
        JobState state;
        uint8 refundVotes;
        uint8 releaseVotes;
    }

    uint256 public jobCount;
    uint256 public constant REVIEW_PERIOD = 3 days;

    mapping(uint256 => Job) public jobs;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => DisputeDecision)) public votes;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed freelancer,
        address[3] arbitrators,
        uint256 amount,
        uint256 deadline,
        string title
    );
    event JobAccepted(uint256 indexed jobId, address indexed freelancer);
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
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy);
    event DisputeVoteCast(
        uint256 indexed jobId,
        address indexed arbitrator,
        DisputeDecision decision,
        uint8 refundVotes,
        uint8 releaseVotes
    );
    event DisputeResolved(
        uint256 indexed jobId,
        DisputeDecision decision,
        address indexed recipient,
        uint256 amount
    );
    event ReviewTimeoutClaimed(
        uint256 indexed jobId,
        address indexed freelancer,
        uint256 amount
    );

    function createJob(
        string calldata _title,
        address payable _freelancer,
        address[3] calldata _arbitrators,
        uint256 _deadline
    ) external payable returns (uint256) {
        require(bytes(_title).length > 0, "Title cannot be empty");
        require(_freelancer != address(0), "Invalid freelancer");
        require(msg.value > 0, "Payment must be greater than zero");
        require(_deadline > block.timestamp, "Deadline must be in future");
        require(_freelancer != msg.sender, "Client cannot be freelancer");

        for (uint256 i = 0; i < 3; ++i) {
            address arbitrator = _arbitrators[i];
            require(arbitrator != address(0), "Invalid arbitrator");
            require(arbitrator != msg.sender, "Client cannot be arbitrator");
            require(arbitrator != _freelancer, "Freelancer cannot be arbitrator");

            for (uint256 j = 0; j < i; ++j) {
                require(arbitrator != _arbitrators[j], "Arbitrators must be distinct");
            }
        }

        uint256 newJobId = ++jobCount;
        Job storage job = jobs[newJobId];
        job.client = payable(msg.sender);
        job.freelancer = _freelancer;
        job.arbitrators = _arbitrators;
        job.amount = msg.value;
        job.title = _title;
        job.deadline = _deadline;
        job.createdAt = block.timestamp;
        job.state = JobState.FUNDED;

        emit JobCreated(
            newJobId,
            msg.sender,
            _freelancer,
            _arbitrators,
            msg.value,
            _deadline,
            _title
        );

        return newJobId;
    }

    function acceptJob(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(msg.sender == job.freelancer, "Only freelancer can accept");
        require(job.state == JobState.FUNDED, "Job is not funded");
        require(block.timestamp < job.deadline, "Deadline has passed");

        job.state = JobState.ACCEPTED;
        emit JobAccepted(_jobId, msg.sender);
    }

    function submitWork(uint256 _jobId, string calldata _workProof) external {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(msg.sender == job.freelancer, "Only freelancer can submit");
        require(job.state == JobState.ACCEPTED, "Job is not accepted");
        require(block.timestamp <= job.deadline, "Deadline has passed");
        require(bytes(_workProof).length > 0, "Work proof cannot be empty");

        job.workProof = _workProof;
        job.submittedAt = block.timestamp;
        job.state = JobState.SUBMITTED;
        emit WorkSubmitted(_jobId, msg.sender, _workProof, block.timestamp);
    }

    function approveWork(uint256 _jobId) external nonReentrant {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(msg.sender == job.client, "Only client can approve");
        require(job.state == JobState.SUBMITTED, "Work is not submitted");

        uint256 amount = job.amount;
        job.state = JobState.RELEASED;

        (bool success, ) = job.freelancer.call{value: amount}("");
        require(success, "Payment transfer failed");

        emit PaymentReleased(_jobId, msg.sender, job.freelancer, amount);
    }

    function refundAfterDeadline(uint256 _jobId) external nonReentrant {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(msg.sender == job.client, "Only client can request refund");
        require(block.timestamp > job.deadline, "Deadline has not passed");
        require(
            job.state == JobState.FUNDED || job.state == JobState.ACCEPTED,
            "Refund not allowed"
        );

        uint256 amount = job.amount;
        job.state = JobState.REFUNDED;

        (bool success, ) = job.client.call{value: amount}("");
        require(success, "Refund transfer failed");

        emit RefundIssued(_jobId, msg.sender, amount);
    }

    function raiseDispute(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(
            msg.sender == job.client || msg.sender == job.freelancer,
            "Only client or freelancer can dispute"
        );
        require(job.state == JobState.SUBMITTED, "Dispute not allowed");
        require(
            block.timestamp <= job.submittedAt + REVIEW_PERIOD,
            "Review period has expired"
        );

        job.state = JobState.DISPUTED;
        emit DisputeRaised(_jobId, msg.sender);
    }

    function castDisputeVote(
        uint256 _jobId,
        DisputeDecision _decision
    ) external nonReentrant {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(job.state == JobState.DISPUTED, "Job is not disputed");
        require(isArbitrator(_jobId, msg.sender), "Only designated arbitrator can vote");
        require(!hasVoted[_jobId][msg.sender], "Arbitrator already voted");
        require(
            _decision == DisputeDecision.REFUND ||
                _decision == DisputeDecision.RELEASE,
            "Invalid decision"
        );

        hasVoted[_jobId][msg.sender] = true;
        votes[_jobId][msg.sender] = _decision;

        if (_decision == DisputeDecision.REFUND) {
            ++job.refundVotes;
        } else {
            ++job.releaseVotes;
        }

        emit DisputeVoteCast(
            _jobId,
            msg.sender,
            _decision,
            job.refundVotes,
            job.releaseVotes
        );

        if (job.refundVotes < 2 && job.releaseVotes < 2) {
            return;
        }

        address payable recipient;
        DisputeDecision finalDecision;
        if (job.refundVotes == 2) {
            job.state = JobState.REFUNDED;
            recipient = job.client;
            finalDecision = DisputeDecision.REFUND;
        } else {
            job.state = JobState.RELEASED;
            recipient = job.freelancer;
            finalDecision = DisputeDecision.RELEASE;
        }

        uint256 amount = job.amount;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit DisputeResolved(_jobId, finalDecision, recipient, amount);
    }

    function claimAfterReviewTimeout(uint256 _jobId) external nonReentrant {
        Job storage job = jobs[_jobId];
        require(job.state != JobState.NONE, "Job does not exist");
        require(msg.sender == job.freelancer, "Only freelancer can claim");
        require(job.state == JobState.SUBMITTED, "Work is not submitted");
        require(
            block.timestamp > job.submittedAt + REVIEW_PERIOD,
            "Review period has not passed"
        );

        uint256 amount = job.amount;
        job.state = JobState.RELEASED;

        (bool success, ) = job.freelancer.call{value: amount}("");
        require(success, "Payment transfer failed");

        emit ReviewTimeoutClaimed(_jobId, msg.sender, amount);
    }

    function getArbitrators(uint256 _jobId) external view returns (address[3] memory) {
        require(jobs[_jobId].state != JobState.NONE, "Job does not exist");
        return jobs[_jobId].arbitrators;
    }

    function getVoteCounts(
        uint256 _jobId
    ) external view returns (uint8 refundVotes, uint8 releaseVotes) {
        require(jobs[_jobId].state != JobState.NONE, "Job does not exist");
        Job storage job = jobs[_jobId];
        return (job.refundVotes, job.releaseVotes);
    }

    function isArbitrator(uint256 _jobId, address _account) public view returns (bool) {
        if (
            _account == address(0) ||
            jobs[_jobId].state == JobState.NONE
        ) {
            return false;
        }

        address[3] storage arbitrators = jobs[_jobId].arbitrators;
        return
            arbitrators[0] == _account ||
            arbitrators[1] == _account ||
            arbitrators[2] == _account;
    }
}
