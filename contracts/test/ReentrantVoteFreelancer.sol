// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFreelanceEscrowV2VoteTarget {
    function acceptJob(uint256 _jobId) external;

    function submitWork(uint256 _jobId, string calldata _workProof) external;

    function claimAfterReviewTimeout(uint256 _jobId) external;
}

contract ReentrantVoteFreelancer {
    IFreelanceEscrowV2VoteTarget public immutable escrow;

    uint256 public targetJobId;
    uint256 public receiveCount;
    uint256 public totalReceived;
    bool public attackEnabled;
    bool public attackAttempted;
    bool public reentrySucceeded;

    constructor(address _escrow) {
        escrow = IFreelanceEscrowV2VoteTarget(_escrow);
    }

    function accept(uint256 _jobId) external {
        escrow.acceptJob(_jobId);
    }

    function submit(uint256 _jobId, string calldata _proof) external {
        escrow.submitWork(_jobId, _proof);
    }

    function armAttack(uint256 _jobId) external {
        targetJobId = _jobId;
        attackEnabled = true;
    }

    receive() external payable {
        ++receiveCount;
        totalReceived += msg.value;

        if (attackEnabled) {
            attackEnabled = false;
            attackAttempted = true;

            (bool success, ) = address(escrow).call(
                abi.encodeWithSignature(
                    "claimAfterReviewTimeout(uint256)",
                    targetJobId
                )
            );

            reentrySucceeded = success;
        }
    }
}
