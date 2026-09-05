// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IEscrow {

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


contract RejectEtherFreelancer {

    IEscrow public escrow;

    constructor(
        address _escrow
    ) {
        escrow = IEscrow(_escrow);
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


    function claim(
        uint256 _jobId
    ) external {

        escrow.claimAfterReviewTimeout(
            _jobId
        );
    }


    // Refuse all incoming ETH
    receive() external payable {

        revert(
            "ETH rejected"
        );
    }
}