
 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IERC20Escrow {
    function balanceOf(address account) external view returns (uint256);
}

contract Escrow {
    enum Status {
        Created,
        Funded,
        Released,
        Refunded,
        Delivered,
        Disputed,
        Cancelled
    }

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        Status status;
        bool buyerApproved;
        bool sellerApproved;
        uint256 reviewDeadline;
        bool extensionUsed;
        bool buyerResolutionVoted;
        bool sellerResolutionVoted;
        bool proposedReleaseToSeller;
        address token;
        uint256 deadline;
        uint256 remainingAmount;
        uint256 approvalThreshold;
        uint256 approvalCount;
        uint256 milestoneCount;
        bool milestoneMode;
        bool multiParty;
    }

    uint256 public nextDealId;
    address public immutable arbitrator;
    uint256 private _reentrancyStatus = 1;
    mapping(uint256 => mapping(address => bool)) public releaseApprovals;
    mapping(uint256 => mapping(address => bool)) public releaseApprover;
    mapping(uint256 => mapping(address => bool)) public disputeResolutionVoted;
    mapping(uint256 => uint256) public disputeResolutionVoteCount;
    mapping(uint256 => uint256[]) private _milestoneAmounts;
    mapping(uint256 => uint256) public nextMilestoneToDeliver;
    mapping(uint256 => mapping(uint256 => bool)) public milestoneDelivered;
    mapping(address => uint256) public agreementNonces;
    mapping(address => bool) public supportedTokens;

    uint256 public constant REVIEW_PERIOD = 3 days;
    uint256 public constant EXTENSION_PERIOD = 3 days;
    uint256 public constant MAX_APPROVERS = 20;
    uint256 public constant MAX_MILESTONES = 20;
    uint256 private constant _SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant _AGREEMENT_TYPEHASH = keccak256(
        "Agreement(address buyer,address seller,uint256 amount,address token,uint256 deadline,uint256 nonce)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _NAME_HASH = keccak256("Universal Escrow");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    mapping(uint256 => Deal) public deals;

    constructor() {
        arbitrator = msg.sender;
    }

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Only arbitrator");
        _;
    }

    event EscrowCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );

    event EscrowFunded(uint256 indexed dealId, uint256 amount);

    event DeliverySubmitted(
        uint256 indexed dealId,
        uint256 reviewDeadline
    );

    event ReviewExtended(
        uint256 indexed dealId,
        uint256 newDeadline
    );

    event ReleaseApproved(uint256 indexed dealId, address approver);
    event DisputeRaised(uint256 indexed dealId);
    event DisputeReasonSubmitted(
        uint256 indexed dealId,
        address indexed initiator,
        string reason
    );

    event DisputeResolved(
        uint256 indexed dealId,
        bool releasedToSeller
    );

    event EscrowReleased(
        uint256 indexed dealId,
        address seller,
        uint256 amount
    );

    event EscrowRefunded(
        uint256 indexed dealId,
        address buyer,
        uint256 amount
    );
    event EscrowCancelled(uint256 indexed dealId);
    event MilestoneSubmitted(
        uint256 indexed dealId,
        uint256 indexed milestone,
        uint256 amount,
        uint256 reviewDeadline
    );
    event MilestonePaid(
        uint256 indexed dealId,
        uint256 indexed milestone,
        address recipient,
        uint256 amount
    );
    event EscrowTermsCreated(
        uint256 indexed dealId,
        address indexed token,
        uint256 deadline,
        uint256 approvalThreshold
    );
    event TokenSupportUpdated(address indexed token, bool supported);

    modifier nonReentrant() {
        require(_reentrancyStatus == 1, "Reentrant call");
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    function createEscrow(
        address seller,
        uint256 amount
    ) external returns (uint256 dealId) {
        address[] memory approvers = new address[](2);
        approvers[0] = msg.sender;
        approvers[1] = seller;
        dealId = _createEscrow(
            msg.sender,
            seller,
            amount,
            address(0),
            0,
            approvers,
            2,
            false,
            false,
            new uint256[](0)
        );
    }

    function setSupportedToken(address token, bool supported) external onlyArbitrator {
        require(token != address(0) && token.code.length > 0, "Invalid token");
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    function createEscrowWithTerms(
        address seller,
        uint256 amount,
        address token,
        uint256 deadline,
        uint256 approvalThreshold
    ) external returns (uint256 dealId) {
        address[] memory approvers = new address[](2);
        approvers[0] = msg.sender;
        approvers[1] = seller;
        dealId = _createEscrow(
            msg.sender,
            seller,
            amount,
            token,
            deadline,
            approvers,
            approvalThreshold,
            false,
            false,
            new uint256[](0)
        );
        emit EscrowTermsCreated(dealId, token, deadline, approvalThreshold);
    }

    function createMultiPartyEscrow(
        address seller,
        uint256 amount,
        address token,
        uint256 deadline,
        address[] calldata approvers,
        uint256 approvalThreshold
    ) external returns (uint256 dealId) {
        dealId = _createEscrow(
            msg.sender,
            seller,
            amount,
            token,
            deadline,
            approvers,
            approvalThreshold,
            false,
            true,
            new uint256[](0)
        );
        emit EscrowTermsCreated(dealId, token, deadline, approvalThreshold);
    }

    function createMilestoneEscrow(
        address seller,
        address token,
        uint256 deadline,
        uint256[] calldata milestoneAmounts
    ) external returns (uint256 dealId) {
        require(
            milestoneAmounts.length > 0 &&
                milestoneAmounts.length <= MAX_MILESTONES,
            "Invalid milestone count"
        );
        uint256 total;
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            require(milestoneAmounts[i] > 0, "Milestone amount must be positive");
            total += milestoneAmounts[i];
        }
        address[] memory approvers = new address[](2);
        approvers[0] = msg.sender;
        approvers[1] = seller;
        dealId = _createEscrow(
            msg.sender,
            seller,
            total,
            token,
            deadline,
            approvers,
            2,
            true,
            false,
            milestoneAmounts
        );
        emit EscrowTermsCreated(dealId, token, deadline, 2);
    }

    function createSignedEscrow(
        address buyer,
        address seller,
        uint256 amount,
        address token,
        uint256 deadline,
        uint256 nonce,
        bytes calldata buyerSignature,
        bytes calldata sellerSignature
    ) external returns (uint256 dealId) {
        require(deadline > block.timestamp, "Invalid deadline");
        require(nonce == agreementNonces[buyer], "Invalid agreement nonce");
        bytes32 structHash = keccak256(
            abi.encode(
                _AGREEMENT_TYPEHASH,
                buyer,
                seller,
                amount,
                token,
                deadline,
                nonce
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                _NAME_HASH,
                _VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );
        require(
            _recoverSigner(digest, buyerSignature) == buyer,
            "Invalid buyer signature"
        );
        require(
            _recoverSigner(digest, sellerSignature) == seller,
            "Invalid seller signature"
        );
        ++agreementNonces[buyer];
        address[] memory approvers = new address[](2);
        approvers[0] = buyer;
        approvers[1] = seller;
        dealId = _createEscrow(
            buyer,
            seller,
            amount,
            token,
            deadline,
            approvers,
            2,
            false,
            false,
            new uint256[](0)
        );
        emit EscrowTermsCreated(dealId, token, deadline, 2);
    }

    function _createEscrow(
        address buyer,
        address seller,
        uint256 amount,
        address token,
        uint256 deadline,
        address[] memory approvers,
        uint256 approvalThreshold,
        bool milestoneMode,
        bool multiParty,
        uint256[] memory milestoneAmounts
    ) internal returns (uint256 dealId) {
        require(seller != address(0), "Invalid seller");
        require(seller != buyer, "Buyer cannot be seller");
        require(seller != address(this), "Invalid seller");
        require(amount > 0, "Amount must be positive");
        require(
            token == address(0) ||
                (token.code.length > 0 && supportedTokens[token]),
            "Unsupported token"
        );
        require(
            deadline == 0 || deadline > block.timestamp,
            "Invalid deadline"
        );
        require(
            approvers.length >= 2 && approvers.length <= MAX_APPROVERS,
            "Invalid approver count"
        );
        require(
            approvalThreshold > 0 && approvalThreshold <= approvers.length,
            "Invalid approval threshold"
        );

        bool hasBuyer;
        bool hasSeller;
        for (uint256 i; i < approvers.length; ++i) {
            address approver = approvers[i];
            require(approver != address(0), "Invalid approver");
            for (uint256 j; j < i; ++j) {
                require(approvers[j] != approver, "Duplicate approver");
            }
            if (approver == buyer) hasBuyer = true;
            if (approver == seller) hasSeller = true;
        }
        require(hasBuyer && hasSeller, "Buyer and seller must approve");

        dealId = nextDealId++;
        Deal storage deal = deals[dealId];
        deal.buyer = buyer;
        deal.seller = seller;
        deal.amount = amount;
        deal.status = Status.Created;
        deal.token = token;
        deal.deadline = deadline;
        deal.remainingAmount = amount;
        deal.approvalThreshold = approvalThreshold;
        deal.milestoneMode = milestoneMode;
        deal.multiParty = multiParty;
        deal.milestoneCount = milestoneAmounts.length;

        for (uint256 i; i < approvers.length; ++i) {
            releaseApprover[dealId][approvers[i]] = true;
        }
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            _milestoneAmounts[dealId].push(milestoneAmounts[i]);
        }
        emit EscrowCreated(dealId, buyer, seller, amount);
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address signer) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(
            uint256(s) <= _SECP256K1_HALF_ORDER && (v == 27 || v == 28),
            "Invalid signature"
        );
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
    }

    function fundEscrow(uint256 dealId) external payable nonReentrant {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.buyer, "Only buyer can fund");
        require(deal.status == Status.Created, "Escrow not awaiting funding");
        require(
            deal.deadline == 0 || block.timestamp <= deal.deadline,
            "Funding deadline passed"
        );
        deal.status = Status.Funded;
        if (deal.token == address(0)) {
            require(msg.value == deal.amount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "Unexpected ETH");
            uint256 beforeBalance = _tokenBalance(deal.token, address(this));
            _safeTokenCall(
                deal.token,
                abi.encodeWithSelector(
                    0x23b872dd,
                    msg.sender,
                    address(this),
                    deal.amount
                ),
                false
            );
            require(
                _tokenBalance(deal.token, address(this)) - beforeBalance ==
                    deal.amount,
                "Unsupported fee-on-transfer token"
            );
        }

        emit EscrowFunded(dealId, deal.amount);
    }

    function cancelEscrow(uint256 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.buyer, "Only buyer can cancel");
        require(deal.status == Status.Created, "Escrow not cancellable");
        deal.status = Status.Cancelled;
        emit EscrowCancelled(dealId);
    }

    function refundEscrow(uint256 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.status == Status.Funded, "Escrow not refundable");
        require(
            deal.deadline != 0 && block.timestamp > deal.deadline,
            "Refund deadline not reached"
        );
        _settleToBuyer(dealId, deal);
    }

    function submitDelivery(uint256 dealId) external {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.seller, "Only seller can submit delivery");
        require(!deal.milestoneMode, "Use milestone submission");
        require(deal.status == Status.Funded, "Escrow not funded");

        deal.status = Status.Delivered;
        deal.reviewDeadline = block.timestamp + REVIEW_PERIOD;

        emit DeliverySubmitted(dealId, deal.reviewDeadline);
    }

    function requestReviewExtension(uint256 dealId) external {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.buyer, "Only buyer can extend review");
        require(deal.status == Status.Delivered, "Not awaiting review");
        require(block.timestamp <= deal.reviewDeadline, "Review period ended");
        require(!deal.extensionUsed, "Extension already used");

        deal.extensionUsed = true;
        deal.reviewDeadline += EXTENSION_PERIOD;

        emit ReviewExtended(dealId, deal.reviewDeadline);
    }

    function approveRelease(uint256 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.status == Status.Delivered, "Not awaiting approval");
        require(block.timestamp <= deal.reviewDeadline, "Review period ended");
        require(!deal.milestoneMode, "Use milestone approval");
        require(releaseApprover[dealId][msg.sender], "Not a party");
        if (releaseApprovals[dealId][msg.sender]) {
            if (msg.sender == deal.buyer) {
                revert("Buyer already approved");
            }
            if (msg.sender == deal.seller) {
                revert("Seller already approved");
            }
            revert("Already approved");
        }
        releaseApprovals[dealId][msg.sender] = true;
        ++deal.approvalCount;

        if (msg.sender == deal.buyer) {
            deal.buyerApproved = true;
        }
        if (msg.sender == deal.seller) {
            deal.sellerApproved = true;
        }

        emit ReleaseApproved(dealId, msg.sender);

        if (deal.approvalCount >= deal.approvalThreshold) {
            _releaseToSeller(dealId, deal);
        }
    }

    function releaseAfterTimeout(uint256 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.status == Status.Delivered, "Not awaiting review");
        require(block.timestamp > deal.reviewDeadline, "Review period active");
        require(!deal.milestoneMode, "Use milestone timeout release");
        require(!deal.multiParty, "Multi-party timeout release disabled");

        _releaseToSeller(dealId, deal);
    }

    function raiseDispute(uint256 dealId) external {
        _raiseDispute(dealId);
    }

    function raiseDisputeWithReason(
        uint256 dealId,
        string calldata reason
    ) external {
        bytes memory reasonBytes = bytes(reason);
        require(reasonBytes.length > 0 && reasonBytes.length <= 1024, "Invalid dispute reason");
        _raiseDispute(dealId);
        emit DisputeReasonSubmitted(dealId, msg.sender, reason);
    }

    function _raiseDispute(uint256 dealId) internal {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(releaseApprover[dealId][msg.sender], "Only a party can dispute");
        require(deal.status == Status.Delivered, "Not awaiting review");
        if (!deal.multiParty) {
            require(block.timestamp <= deal.reviewDeadline, "Review period ended");
        }

        deal.status = Status.Disputed;

        emit DisputeRaised(dealId);
    }

    function approveDisputeResolution(
        uint256 dealId,
        bool releaseToSeller
    ) external nonReentrant {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.status == Status.Disputed, "No active dispute");
        require(
            releaseApprover[dealId][msg.sender],
            "Not a party"
        );

        bool hasPriorVote = disputeResolutionVoteCount[dealId] > 0;

        if (hasPriorVote) {
            require(
                deal.proposedReleaseToSeller == releaseToSeller,
                "Resolution mismatch"
            );
        } else {
            deal.proposedReleaseToSeller = releaseToSeller;
        }

        if (msg.sender == deal.buyer) {
            require(!deal.buyerResolutionVoted, "Buyer already voted");
        } else if (msg.sender == deal.seller) {
            require(!deal.sellerResolutionVoted, "Seller already voted");
        } else {
            require(!disputeResolutionVoted[dealId][msg.sender], "Already voted");
        }
        disputeResolutionVoted[dealId][msg.sender] = true;
        ++disputeResolutionVoteCount[dealId];

        if (msg.sender == deal.buyer) {
            deal.buyerResolutionVoted = true;
        } else if (msg.sender == deal.seller) {
            deal.sellerResolutionVoted = true;
        }

        if (disputeResolutionVoteCount[dealId] >= deal.approvalThreshold) {
            _settleDispute(dealId, deal, releaseToSeller);
        }
    }

    // NEW: Only the designated arbitrator can resolve a dispute.
    function resolveDispute(
        uint256 dealId,
        bool releaseToSeller
    ) external onlyArbitrator nonReentrant {
        Deal storage deal = deals[dealId];

        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.status == Status.Disputed, "No active dispute");

        _settleDispute(dealId, deal, releaseToSeller);
    }

    function _releaseToSeller(
        uint256 dealId,
        Deal storage deal
    ) internal {
        uint256 amount = deal.remainingAmount;
        address seller = deal.seller;

        deal.status = Status.Released;
        deal.remainingAmount = 0;
        _pay(deal, seller, amount, false);

        emit EscrowReleased(dealId, seller, amount);
    }

    function _settleDispute(
        uint256 dealId,
        Deal storage deal,
        bool releaseToSeller
    ) internal {
        uint256 amount = deal.remainingAmount;
        address recipient = releaseToSeller ? deal.seller : deal.buyer;

        deal.status = releaseToSeller ? Status.Released : Status.Refunded;
        deal.remainingAmount = 0;

        _pay(deal, recipient, amount, true);

        emit DisputeResolved(dealId, releaseToSeller);

        if (releaseToSeller) {
            emit EscrowReleased(dealId, recipient, amount);
        } else {
            emit EscrowRefunded(dealId, recipient, amount);
        }
    }

    function _settleToBuyer(uint256 dealId, Deal storage deal) internal {
        uint256 amount = deal.remainingAmount;
        deal.status = Status.Refunded;
        deal.remainingAmount = 0;
        _pay(deal, deal.buyer, amount, false);
        emit EscrowRefunded(dealId, deal.buyer, amount);
    }

    function _pay(
        Deal storage deal,
        address recipient,
        uint256 amount,
        bool disputeSettlement
    ) internal {
        if (deal.token == address(0)) {
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (disputeSettlement) {
                require(success, "Settlement failed");
            } else {
                require(success, "Payment failed");
            }
            return;
        }
        uint256 escrowBefore = _tokenBalance(deal.token, address(this));
        uint256 recipientBefore = _tokenBalance(deal.token, recipient);
        _safeTokenCall(
            deal.token,
            abi.encodeWithSelector(0xa9059cbb, recipient, amount),
            disputeSettlement
        );
        require(
            escrowBefore - _tokenBalance(deal.token, address(this)) == amount &&
                _tokenBalance(deal.token, recipient) - recipientBefore == amount,
            "Unsupported fee-on-transfer token"
        );
    }

    function _safeTokenCall(
        address token,
        bytes memory callData,
        bool disputeSettlement
    ) internal {
        (bool success, bytes memory result) = token.call(callData);
        if (!success) {
            if (disputeSettlement) {
                revert("Settlement failed");
            }
            revert("Token transfer failed");
        }
        if (result.length > 0) {
            bool transferSucceeded = result.length >= 32 &&
                abi.decode(result, (bool));
            if (!transferSucceeded) {
                if (disputeSettlement) {
                    revert("Settlement failed");
                }
                revert("Token transfer failed");
            }
        }
    }

    function _tokenBalance(
        address token,
        address account
    ) internal view returns (uint256 balance) {
        (bool success, bytes memory result) = token.staticcall(
            abi.encodeWithSelector(IERC20Escrow.balanceOf.selector, account)
        );
        require(
            success && result.length >= 32,
            "Token balance query failed"
        );
        balance = abi.decode(result, (uint256));
    }

    function milestoneAmount(
        uint256 dealId,
        uint256 milestone
    ) external view returns (uint256) {
        require(milestone < _milestoneAmounts[dealId].length, "Invalid milestone");
        return _milestoneAmounts[dealId][milestone];
    }

    function submitMilestone(uint256 dealId) external {
        Deal storage deal = deals[dealId];
        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.seller, "Only seller can submit delivery");
        require(deal.milestoneMode, "Not a milestone escrow");
        require(deal.status == Status.Funded, "Escrow not funded");
        uint256 milestone = nextMilestoneToDeliver[dealId];
        require(milestone < deal.milestoneCount, "All milestones submitted");
        milestoneDelivered[dealId][milestone] = true;
        deal.status = Status.Delivered;
        deal.reviewDeadline = block.timestamp + REVIEW_PERIOD;
        emit MilestoneSubmitted(
            dealId,
            milestone,
            _milestoneAmounts[dealId][milestone],
            deal.reviewDeadline
        );
    }

    function approveMilestone(uint256 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.buyer != address(0), "Escrow does not exist");
        require(msg.sender == deal.buyer, "Only buyer can approve milestone");
        require(deal.milestoneMode, "Not a milestone escrow");
        require(deal.status == Status.Delivered, "No milestone awaiting review");
        require(block.timestamp <= deal.reviewDeadline, "Review period ended");
        uint256 milestone = nextMilestoneToDeliver[dealId];
        _payMilestone(dealId, deal, milestone);
    }

    function releaseMilestoneAfterTimeout(
        uint256 dealId
    ) external nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.buyer != address(0), "Escrow does not exist");
        require(deal.milestoneMode, "Not a milestone escrow");
        require(deal.status == Status.Delivered, "No milestone awaiting review");
        require(block.timestamp > deal.reviewDeadline, "Review period active");
        uint256 milestone = nextMilestoneToDeliver[dealId];
        _payMilestone(dealId, deal, milestone);
    }

    function _payMilestone(
        uint256 dealId,
        Deal storage deal,
        uint256 milestone
    ) internal {
        require(milestoneDelivered[dealId][milestone], "Milestone not submitted");
        uint256 amount = _milestoneAmounts[dealId][milestone];
        deal.remainingAmount -= amount;
        ++nextMilestoneToDeliver[dealId];
        deal.status = deal.remainingAmount == 0 ? Status.Released : Status.Funded;
        _pay(deal, deal.seller, amount, false);
        emit MilestonePaid(dealId, milestone, deal.seller, amount);
    }

    function getStatus(uint256 dealId) external view returns (Status) {
        require(deals[dealId].buyer != address(0), "Escrow does not exist");
        return deals[dealId].status;
    }
}
