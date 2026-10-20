
 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IEscrowDelivery {
    function submitDelivery(uint256 dealId) external;
}

interface IEscrowBuyerActions {
    function createEscrow(
        address seller,
        uint256 amount
    ) external returns (uint256 dealId);
    function fundEscrow(uint256 dealId) external payable;
    function raiseDispute(uint256 dealId) external;
}

contract RejectEther {
    receive() external payable {
        revert("ETH rejected");
    }

    function submitDelivery(address escrow, uint256 dealId) external {
        IEscrowDelivery(escrow).submitDelivery(dealId);
    }

    function createEscrow(
        address escrow,
        address seller,
        uint256 amount
    ) external returns (uint256 dealId) {
        return IEscrowBuyerActions(escrow).createEscrow(seller, amount);
    }

    function fundEscrow(address escrow, uint256 dealId) external payable {
        IEscrowBuyerActions(escrow).fundEscrow{value: msg.value}(dealId);
    }

    function raiseDispute(address escrow, uint256 dealId) external {
        IEscrowBuyerActions(escrow).raiseDispute(dealId);
    }
}
