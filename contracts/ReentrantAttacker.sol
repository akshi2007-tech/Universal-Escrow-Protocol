
 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IEscrowAttackTarget {
    function submitDelivery(uint256 dealId) external;
    function releaseAfterTimeout(uint256 dealId) external;
}

contract ReentrantAttacker {
    IEscrowAttackTarget public immutable escrow;
    uint256 public immutable dealId;
    uint256 public attempts;
    bool public reentryAttemptFailed;

    constructor(address escrowAddress, uint256 _dealId) {
        escrow = IEscrowAttackTarget(escrowAddress);
        dealId = _dealId;
    }

    function submitDelivery() external {
        escrow.submitDelivery(dealId);
    }

    function attack() external {
        escrow.releaseAfterTimeout(dealId);
    }

    receive() external payable {
        attempts++;

        // Try releasing the same deal again during payment.
        try escrow.releaseAfterTimeout(dealId) {
            // If this succeeds, the reentrant attempt was not blocked.
        } catch {
            // Expected: the deal is already Released.
            reentryAttemptFailed = true;
        }
    }
}

 