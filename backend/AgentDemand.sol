// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentDemand
/// @notice Funded onchain demand order book for AI-agent capabilities.
/// @dev Non-upgradeable. Exact-string duplicate prevention only; semantic clustering is offchain.
contract AgentDemand is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Open,
        Submitted,
        Fulfilled,
        Closed
    }

    struct Demand {
        address creator;
        address builder;
        uint96 maxUnitPrice;
        uint128 committed;
        uint128 reviewCommitted;
        uint128 approvalRequired;
        uint64 expectedCalls;
        uint64 deadline;
        uint64 reviewEndsAt;
        uint32 supporterCount;
        Status status;
        string capability;
        string specification;
        string serviceUrl;
        bytes32 evidenceHash;
    }

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint16 public immutable quorumBps;
    uint96 public immutable minCommitment;
    uint32 public immutable reviewPeriod;
    uint256 public nextDemandId = 1;
    uint256 public totalEscrowed;

    mapping(uint256 => Demand) private demands;
    mapping(uint256 => mapping(address => uint96)) public commitmentOf;
    mapping(uint256 => mapping(address => uint64)) public expectedCallsOf;
    mapping(uint256 => uint256) public submissionNonce;
    mapping(uint256 => uint256) public approvalWeight;
    mapping(uint256 => uint256) public rejectionWeight;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasApproved;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasRejected;
    mapping(bytes32 => uint256) public activeDemandByKey;
    mapping(uint256 => bytes32) public demandKeyOf;

    event DemandCreated(
        uint256 indexed demandId,
        bytes32 indexed demandKey,
        address indexed creator,
        string capability,
        uint96 maxUnitPrice,
        uint64 expectedCalls,
        uint64 deadline,
        uint96 initialCommitment
    );
    event DemandSupported(
        uint256 indexed demandId,
        address indexed supporter,
        uint96 amount,
        uint64 expectedCalls,
        uint128 committedTotal,
        uint32 supporterCount
    );
    event ServiceSubmitted(
        uint256 indexed demandId,
        uint256 indexed submissionNonce,
        address indexed builder,
        string serviceUrl,
        bytes32 evidenceHash,
        uint64 reviewEndsAt,
        uint128 reviewCommitted,
        uint128 approvalRequired
    );
    event ServiceApproved(
        uint256 indexed demandId,
        uint256 indexed submissionNonce,
        address indexed supporter,
        uint96 weight,
        uint256 approvalWeight
    );
    event ServiceRejected(
        uint256 indexed demandId,
        uint256 indexed submissionNonce,
        address indexed supporter,
        uint96 weight,
        uint256 rejectionWeight
    );
    event SubmissionRejected(
        uint256 indexed demandId,
        uint256 indexed submissionNonce,
        address indexed builder,
        uint256 approvalWeight,
        uint256 rejectionWeight,
        uint128 approvalRequired
    );
    event DemandFulfilled(
        uint256 indexed demandId,
        address indexed builder,
        address indexed treasury,
        uint128 approvedAmount,
        uint128 fee,
        uint128 payout,
        uint128 remainingRefundable
    );
    event Refunded(uint256 indexed demandId, address indexed supporter, uint96 amount);
    event DemandClosed(uint256 indexed demandId, bytes32 indexed demandKey);

    error ZeroAddress();
    error InvalidFee();
    error InvalidQuorum();
    error InvalidDeadline();
    error InvalidAmount();
    error InvalidExpectedCalls();
    error InvalidTextLength();
    error InvalidCapability();
    error DemandNotFound();
    error DuplicateDemand();
    error InvalidStatus();
    error DeadlinePassed();
    error ReviewActive();
    error ReviewEnded();
    error NotSupporter();
    error AlreadyApproved();
    error AlreadyRejected();
    error ConflictingVote();
    error QuorumNotReached();
    error NothingToRefund();
    error InvalidEvidence();
    error UnsupportedToken();

    constructor(
        address token_,
        address treasury_,
        uint16 feeBps_,
        uint16 quorumBps_,
        uint96 minCommitment_,
        uint32 reviewPeriod_
    ) {
        if (token_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > 1000) revert InvalidFee();
        if (quorumBps_ <= 5000 || quorumBps_ > 10000) revert InvalidQuorum();
        if (minCommitment_ == 0) revert InvalidAmount();
        if (reviewPeriod_ < 1 hours || reviewPeriod_ > 7 days) revert InvalidDeadline();

        token = IERC20(token_);
        treasury = treasury_;
        feeBps = feeBps_;
        quorumBps = quorumBps_;
        minCommitment = minCommitment_;
        reviewPeriod = reviewPeriod_;
    }

    function createDemand(
        string calldata capability,
        string calldata specification,
        uint96 maxUnitPrice,
        uint64 expectedCalls,
        uint64 deadline,
        uint96 initialCommitment
    ) external nonReentrant returns (uint256 demandId) {
        _validateCapability(capability);
        _checkTextLength(specification, 2048);
        if (maxUnitPrice == 0) revert InvalidAmount();
        if (expectedCalls == 0) revert InvalidExpectedCalls();
        if (deadline < block.timestamp + 1 hours) revert InvalidDeadline();
        if (initialCommitment < minCommitment) revert InvalidAmount();

        bytes32 demandKey = computeDemandKey(capability, specification);
        uint256 current = activeDemandByKey[demandKey];
        if (current != 0 && !_replaceable(current)) revert DuplicateDemand();

        demandId = nextDemandId++;
        activeDemandByKey[demandKey] = demandId;
        demandKeyOf[demandId] = demandKey;

        Demand storage d = demands[demandId];
        d.creator = msg.sender;
        d.maxUnitPrice = maxUnitPrice;
        d.committed = initialCommitment;
        d.expectedCalls = expectedCalls;
        d.deadline = deadline;
        d.supporterCount = 1;
        d.status = Status.Open;
        d.capability = capability;
        d.specification = specification;

        commitmentOf[demandId][msg.sender] = initialCommitment;
        expectedCallsOf[demandId][msg.sender] = expectedCalls;
        totalEscrowed += initialCommitment;

        _pullExact(msg.sender, initialCommitment);

        emit DemandCreated(
            demandId, demandKey, msg.sender, capability, maxUnitPrice, expectedCalls, deadline, initialCommitment
        );
        emit DemandSupported(demandId, msg.sender, initialCommitment, expectedCalls, initialCommitment, 1);
    }

    function supportDemand(uint256 demandId, uint96 amount, uint64 expectedCalls) external nonReentrant {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Open) revert InvalidStatus();
        if (block.timestamp >= d.deadline) revert DeadlinePassed();
        if (amount < minCommitment) revert InvalidAmount();
        if (expectedCalls == 0) revert InvalidExpectedCalls();

        uint96 previous = commitmentOf[demandId][msg.sender];
        commitmentOf[demandId][msg.sender] = previous + amount;
        expectedCallsOf[demandId][msg.sender] += expectedCalls;
        d.committed += amount;
        d.expectedCalls += expectedCalls;
        if (previous == 0) d.supporterCount += 1;
        totalEscrowed += amount;

        _pullExact(msg.sender, amount);

        emit DemandSupported(demandId, msg.sender, amount, expectedCalls, d.committed, d.supporterCount);
    }

    function submitService(uint256 demandId, string calldata serviceUrl, bytes32 evidenceHash) external {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Open) revert InvalidStatus();
        if (block.timestamp >= d.deadline) revert DeadlinePassed();
        _checkTextLength(serviceUrl, 512);
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();

        d.builder = msg.sender;
        d.serviceUrl = serviceUrl;
        d.evidenceHash = evidenceHash;
        d.reviewEndsAt = uint64(block.timestamp) + reviewPeriod;
        d.reviewCommitted = d.committed;
        d.approvalRequired = uint128(_ceilDiv(uint256(d.committed) * quorumBps, 10_000));
        d.status = Status.Submitted;

        uint256 nonce = ++submissionNonce[demandId];
        approvalWeight[demandId] = 0;
        rejectionWeight[demandId] = 0;

        emit ServiceSubmitted(
            demandId, nonce, msg.sender, serviceUrl, evidenceHash, d.reviewEndsAt, d.reviewCommitted, d.approvalRequired
        );
    }

    function approveService(uint256 demandId) external {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp >= d.reviewEndsAt) revert ReviewEnded();

        uint96 weight = commitmentOf[demandId][msg.sender];
        if (weight == 0) revert NotSupporter();

        uint256 nonce = submissionNonce[demandId];
        if (hasApproved[demandId][nonce][msg.sender]) revert AlreadyApproved();
        if (hasRejected[demandId][nonce][msg.sender]) revert ConflictingVote();

        hasApproved[demandId][nonce][msg.sender] = true;
        approvalWeight[demandId] += weight;

        emit ServiceApproved(demandId, nonce, msg.sender, weight, approvalWeight[demandId]);
    }

    function rejectService(uint256 demandId) external {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp >= d.reviewEndsAt) revert ReviewEnded();

        uint96 weight = commitmentOf[demandId][msg.sender];
        if (weight == 0) revert NotSupporter();

        uint256 nonce = submissionNonce[demandId];
        if (hasRejected[demandId][nonce][msg.sender]) revert AlreadyRejected();
        if (hasApproved[demandId][nonce][msg.sender]) revert ConflictingVote();

        hasRejected[demandId][nonce][msg.sender] = true;
        rejectionWeight[demandId] += weight;

        emit ServiceRejected(demandId, nonce, msg.sender, weight, rejectionWeight[demandId]);
    }

    function finalize(uint256 demandId) external nonReentrant {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Submitted) revert InvalidStatus();
        if (d.approvalRequired == 0 || approvalWeight[demandId] < d.approvalRequired) revert QuorumNotReached();

        uint128 approvedAmount = uint128(approvalWeight[demandId]);
        if (approvedAmount == 0 || approvedAmount > d.committed) revert InvalidAmount();

        d.status = Status.Fulfilled;
        d.committed -= approvedAmount;
        totalEscrowed -= approvedAmount;
        _clearActiveKeyIfCurrent(demandId);

        uint128 fee = uint128((uint256(approvedAmount) * feeBps) / 10_000);
        uint128 payout = approvedAmount - fee;

        emit DemandFulfilled(demandId, d.builder, treasury, approvedAmount, fee, payout, d.committed);

        if (fee != 0) _pushExact(treasury, fee);
        _pushExact(d.builder, payout);
    }

    function reopen(uint256 demandId) external {
        Demand storage d = _requireDemand(demandId);
        if (d.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp >= d.deadline) revert DeadlinePassed();
        if (approvalWeight[demandId] >= d.approvalRequired) revert InvalidStatus();
        if (block.timestamp < d.reviewEndsAt && !_candidateRejected(demandId, d)) revert ReviewActive();

        uint256 nonce = submissionNonce[demandId];
        emit SubmissionRejected(
            demandId, nonce, d.builder, approvalWeight[demandId], rejectionWeight[demandId], d.approvalRequired
        );

        d.builder = address(0);
        d.serviceUrl = "";
        d.evidenceHash = bytes32(0);
        d.reviewEndsAt = 0;
        d.reviewCommitted = 0;
        d.approvalRequired = 0;
        d.status = Status.Open;
        approvalWeight[demandId] = 0;
        rejectionWeight[demandId] = 0;
    }

    function refund(uint256 demandId) external nonReentrant {
        Demand storage d = _requireDemand(demandId);
        if (!_refundable(demandId, msg.sender)) revert NothingToRefund();

        uint96 amount = commitmentOf[demandId][msg.sender];
        commitmentOf[demandId][msg.sender] = 0;
        expectedCallsOf[demandId][msg.sender] = 0;
        d.committed -= amount;
        // supporterCount and expectedCalls are historical demand signals.
        // They do not shrink when a supporter later exits an expired/rejected demand.
        totalEscrowed -= amount;

        if (d.committed == 0 && d.status != Status.Fulfilled) {
            d.status = Status.Closed;
            _clearActiveKeyIfCurrent(demandId);
            emit DemandClosed(demandId, demandKeyOf[demandId]);
        }

        emit Refunded(demandId, msg.sender, amount);
        _pushExact(msg.sender, amount);
    }

    function getDemand(uint256 demandId) external view returns (Demand memory) {
        Demand storage d = _requireDemand(demandId);
        return d;
    }

    function getSupport(uint256 demandId, address supporter)
        external
        view
        returns (
            uint96 commitment,
            uint64 expectedCalls,
            bool approvedCurrentSubmission,
            bool rejectedCurrentSubmission
        )
    {
        _requireDemand(demandId);
        uint256 nonce = submissionNonce[demandId];
        return (
            commitmentOf[demandId][supporter],
            expectedCallsOf[demandId][supporter],
            hasApproved[demandId][nonce][supporter],
            hasRejected[demandId][nonce][supporter]
        );
    }

    function approvalProgress(uint256 demandId)
        external
        view
        returns (uint256 weight, uint256 required, bool quorumReached)
    {
        Demand storage d = _requireDemand(demandId);
        weight = approvalWeight[demandId];
        required = d.status == Status.Submitted || d.status == Status.Fulfilled ? d.approvalRequired : 0;
        quorumReached = d.status == Status.Fulfilled || (required != 0 && weight >= required);
    }

    function rejectionProgress(uint256 demandId)
        external
        view
        returns (uint256 weight, uint256 thresholdToBlock, bool candidateRejected)
    {
        Demand storage d = _requireDemand(demandId);
        weight = rejectionWeight[demandId];
        thresholdToBlock = d.approvalRequired == 0 ? 0 : uint256(d.reviewCommitted) - d.approvalRequired + 1;
        candidateRejected = d.status == Status.Submitted && thresholdToBlock != 0 && weight >= thresholdToBlock;
    }

    function isRefundable(uint256 demandId, address supporter) external view returns (bool) {
        if (demandId == 0 || demandId >= nextDemandId) return false;
        return _refundable(demandId, supporter);
    }

    function computeDemandKey(string calldata capability, string calldata specification) public pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(capability)), keccak256(bytes(specification))));
    }

    function _replaceable(uint256 demandId) private view returns (bool) {
        Demand storage d = demands[demandId];
        if (d.status == Status.Fulfilled || d.status == Status.Closed) return true;
        if (block.timestamp < d.deadline) return false;
        if (d.status == Status.Open) return true;
        if (d.status == Status.Submitted) {
            bool noQuorum = approvalWeight[demandId] < d.approvalRequired;
            return noQuorum && (block.timestamp >= d.reviewEndsAt || _candidateRejected(demandId, d));
        }
        return false;
    }

    function _refundable(uint256 demandId, address supporter) private view returns (bool) {
        Demand storage d = demands[demandId];
        if (commitmentOf[demandId][supporter] == 0) return false;
        if (d.status == Status.Closed) return false;
        uint256 nonce = submissionNonce[demandId];
        if (d.status == Status.Fulfilled) {
            return !hasApproved[demandId][nonce][supporter];
        }
        if (block.timestamp < d.deadline) return false;
        if (d.status == Status.Submitted) {
            if (approvalWeight[demandId] >= d.approvalRequired) return false;
            if (block.timestamp < d.reviewEndsAt && !_candidateRejected(demandId, d)) return false;
        }
        return true;
    }

    function _candidateRejected(uint256 demandId, Demand storage d) private view returns (bool) {
        if (d.approvalRequired == 0) return false;
        uint256 thresholdToBlock = uint256(d.reviewCommitted) - d.approvalRequired + 1;
        return rejectionWeight[demandId] >= thresholdToBlock;
    }

    function _clearActiveKeyIfCurrent(uint256 demandId) private {
        bytes32 key = demandKeyOf[demandId];
        if (key != bytes32(0) && activeDemandByKey[key] == demandId) activeDemandByKey[key] = 0;
    }

    function _requireDemand(uint256 demandId) private view returns (Demand storage d) {
        if (demandId == 0 || demandId >= nextDemandId) revert DemandNotFound();
        d = demands[demandId];
    }

    function _pullExact(address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
    }

    function _pushExact(address to, uint256 amount) private {
        uint256 beforeRecipient = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(to) - beforeRecipient != amount) revert UnsupportedToken();
        if (token.balanceOf(address(this)) < totalEscrowed) revert UnsupportedToken();
    }

    function _checkTextLength(string calldata value, uint256 maxBytes) private pure {
        uint256 n = bytes(value).length;
        if (n == 0 || n > maxBytes) revert InvalidTextLength();
    }

    function _validateCapability(string calldata value) private pure {
        bytes memory data = bytes(value);
        if (data.length == 0 || data.length > 64) revert InvalidTextLength();
        if (data[0] == 0x2d || data[data.length - 1] == 0x2d) revert InvalidCapability();
        for (uint256 i; i < data.length; ++i) {
            bytes1 c = data[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d;
            if (!ok) revert InvalidCapability();
        }
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        if (a == 0) return 0;
        return (a - 1) / b + 1;
    }
}
