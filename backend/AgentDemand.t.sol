// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentDemand} from "./AgentDemand.sol";

contract MockUSD is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AgentDemandTest is Test {
    MockUSD internal token;
    AgentDemand internal demand;

    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal builder = makeAddr("builder");

    uint16 internal constant FEE_BPS = 200;
    uint16 internal constant QUORUM_BPS = 6000;
    uint96 internal constant MIN_COMMIT = 10_000;
    uint32 internal constant REVIEW = 24 hours;

    string internal constant CAP = "vendor-kyb-singapore";
    string internal constant SPEC = "legal entity status + ownership data + source URLs + JSON";

    function setUp() public {
        token = new MockUSD();
        demand = new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW);
        address[4] memory wallets = [alice, bob, carol, builder];
        for (uint256 i; i < wallets.length; ++i) {
            token.mint(wallets[i], 2_000_000);
            vm.prank(wallets[i]);
            token.approve(address(demand), type(uint256).max);
        }
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _create(address who, uint96 amount) internal returns (uint256 id) {
        vm.prank(who);
        id = demand.createDemand(CAP, SPEC, 20_000, 25_000, _deadline(), amount);
    }

    function _key() internal view returns (bytes32) {
        return demand.computeDemandKey(CAP, SPEC);
    }

    function test_ConstructorValidation() public {
        vm.expectRevert(AgentDemand.ZeroAddress.selector);
        new AgentDemand(address(0), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW);
        vm.expectRevert(AgentDemand.InvalidFee.selector);
        new AgentDemand(address(token), treasury, 1001, QUORUM_BPS, MIN_COMMIT, REVIEW);
        vm.expectRevert(AgentDemand.InvalidQuorum.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, 5000, MIN_COMMIT, REVIEW);
        vm.expectRevert(AgentDemand.InvalidAmount.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, 0, REVIEW);
        vm.expectRevert(AgentDemand.InvalidDeadline.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, 30 minutes);
    }

    function test_CreateValidDemandAndCanonicalKey() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(d.creator, alice);
        assertEq(d.committed, 50_000);
        assertEq(d.supporterCount, 1);
        assertEq(uint8(d.status), uint8(AgentDemand.Status.Open));
        assertEq(d.expectedCalls, 25_000);
        assertEq(token.balanceOf(address(demand)), 50_000);
        assertEq(demand.totalEscrowed(), 50_000);
        assertEq(demand.activeDemandByKey(_key()), id);
    }

    function test_InvalidCreateFields() public {
        vm.startPrank(alice);
        vm.expectRevert(AgentDemand.InvalidCapability.selector);
        demand.createDemand("Vendor-KYB", SPEC, 1, 1, _deadline(), MIN_COMMIT);
        vm.expectRevert(AgentDemand.InvalidAmount.selector);
        demand.createDemand("cap", "spec", 0, 1, _deadline(), MIN_COMMIT);
        vm.expectRevert(AgentDemand.InvalidExpectedCalls.selector);
        demand.createDemand("cap", "spec", 1, 0, _deadline(), MIN_COMMIT);
        vm.expectRevert(AgentDemand.InvalidDeadline.selector);
        demand.createDemand("cap", "spec", 1, 1, uint64(block.timestamp + 30 minutes), MIN_COMMIT);
        vm.expectRevert(AgentDemand.InvalidAmount.selector);
        demand.createDemand("cap", "spec", 1, 1, _deadline(), MIN_COMMIT - 1);
        vm.stopPrank();
    }

    function test_DuplicateActiveDemandReverts() public {
        _create(alice, 50_000);
        vm.prank(bob);
        vm.expectRevert(AgentDemand.DuplicateDemand.selector);
        demand.createDemand(CAP, SPEC, 20_000, 25_000, _deadline(), 50_000);
    }

    function test_ExpiredDemandCanBeReplacedBeforeOldRefunds() public {
        uint256 oldId = _create(alice, 50_000);
        vm.warp(block.timestamp + 8 days);
        vm.prank(bob);
        uint256 newId = demand.createDemand(CAP, SPEC, 20_000, 1_000, uint64(block.timestamp + 7 days), 30_000);
        assertEq(demand.activeDemandByKey(_key()), newId);
        vm.prank(alice);
        demand.refund(oldId);
        assertEq(demand.activeDemandByKey(_key()), newId);
    }

    function test_MultipleSupportersAggregate() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1_000);
        vm.prank(carol);
        demand.supportDemand(id, 20_000, 500);
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(d.committed, 100_000);
        assertEq(d.supporterCount, 3);
        assertEq(d.expectedCalls, 26_500);
        (uint96 amount, uint64 calls,,) = demand.getSupport(id, bob);
        assertEq(amount, 30_000);
        assertEq(calls, 1_000);
        assertEq(demand.totalEscrowed(), 100_000);
    }

    function test_QuorumUsesCeilingAndSnapshot() public {
        uint256 id = _create(alice, 10_001);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(d.reviewCommitted, 10_001);
        assertEq(d.approvalRequired, 6_001);
    }

    function test_SupportBlockedWhileSubmitted() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(bob);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.supportDemand(id, 30_000, 1);
    }

    function test_ApproveRejectAreMutuallyExclusive() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.rejectService(id);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.ConflictingVote.selector);
        demand.approveService(id);
    }

    function test_MathematicalRejectionAllowsEarlyReopen() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1);
        vm.prank(carol);
        demand.supportDemand(id, 20_000, 1);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));

        // 60k approval required; >40k rejection makes quorum impossible.
        vm.prank(alice);
        demand.rejectService(id);
        (uint256 weight, uint256 threshold, bool rejected) = demand.rejectionProgress(id);
        assertEq(weight, 50_000);
        assertEq(threshold, 40_001);
        assertTrue(rejected);

        demand.reopen(id);
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Open));
        assertEq(demand.rejectionWeight(id), 0);
    }

    function test_RefundCannotShrinkQuorum() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1);
        vm.prank(carol);
        demand.supportDemand(id, 20_000, 1);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id); // 50k < fixed 60k
        vm.warp(block.timestamp + 8 days);
        vm.prank(carol);
        demand.refund(id);
        (, uint256 required, bool reached) = demand.approvalProgress(id);
        assertEq(required, 60_000);
        assertFalse(reached);
        vm.expectRevert(AgentDemand.QuorumNotReached.selector);
        demand.finalize(id);
    }

    function test_FinalizePaysOnlyExplicitApprovers() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1_000);
        vm.prank(carol);
        demand.supportDemand(id, 20_000, 500);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id);
        vm.prank(bob);
        demand.approveService(id);

        uint256 builderBefore = token.balanceOf(builder);
        uint256 treasuryBefore = token.balanceOf(treasury);
        demand.finalize(id);

        // Only Alice + Bob's 80k is settled. Carol's 20k remains refundable.
        assertEq(token.balanceOf(builder) - builderBefore, 78_400);
        assertEq(token.balanceOf(treasury) - treasuryBefore, 1_600);
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(uint8(d.status), uint8(AgentDemand.Status.Fulfilled));
        assertEq(d.committed, 20_000);
        assertEq(demand.totalEscrowed(), 20_000);
        assertEq(token.balanceOf(address(demand)), 20_000);
        assertTrue(demand.isRefundable(id, carol));
        assertFalse(demand.isRefundable(id, alice));

        vm.prank(carol);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(demand)), 0);
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Fulfilled));
    }

    function test_BuilderCannotSeizeNonApproverFundsByBuyingQuorum() public {
        uint256 id = _create(alice, 40_000);
        vm.prank(bob);
        demand.supportDemand(id, 60_000, 1);

        // Bob is also the builder and can approve its own 60k, enough for quorum.
        // Alice never approves, so Alice's 40k must never be paid to Bob.
        vm.prank(bob);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(bob);
        demand.approveService(id);
        vm.prank(bob);
        demand.finalize(id);

        assertEq(demand.getDemand(id).committed, 40_000);
        assertTrue(demand.isRefundable(id, alice));
        vm.prank(alice);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
    }

    function test_ApprovedSubmissionCannotRefundApprover() public {
        uint256 id = _create(alice, 60_000);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id);
        demand.finalize(id);
        assertFalse(demand.isRefundable(id, alice));
    }

    function test_StaleApprovalAndRejectionDoNotSurviveReopen() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 50_000, 1);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev1"));
        vm.prank(alice);
        demand.approveService(id);
        uint256 firstNonce = demand.submissionNonce(id);

        vm.warp(block.timestamp + REVIEW + 1);
        demand.reopen(id);
        assertEq(demand.approvalWeight(id), 0);
        assertEq(demand.rejectionWeight(id), 0);

        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb2", keccak256("ev2"));
        assertEq(demand.submissionNonce(id), firstNonce + 1);
        (,, bool approved, bool rejected) = demand.getSupport(id, alice);
        assertFalse(approved);
        assertFalse(rejected);
    }

    function test_ExpiredRefundPreservesHistoricalMetricsAndCloses() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1_000);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        demand.refund(id);
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(d.committed, 30_000);
        assertEq(d.expectedCalls, 26_000);
        assertEq(d.supporterCount, 2);
        assertEq(demand.totalEscrowed(), 30_000);
        vm.prank(bob);
        demand.refund(id);
        d = demand.getDemand(id);
        assertEq(d.committed, 0);
        assertEq(d.expectedCalls, 26_000);
        assertEq(d.supporterCount, 2);
        assertEq(uint8(d.status), uint8(AgentDemand.Status.Closed));
        assertEq(demand.activeDemandByKey(_key()), 0);
        assertEq(demand.totalEscrowed(), 0);
    }

    function test_CannotFinalizeAfterFailedReviewAndRefunds() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 50_000, 1);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id); // 50k < 60k
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        demand.refund(id);
        vm.prank(bob);
        demand.refund(id);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.finalize(id);
    }

    function test_EarlyAndDoubleRefundBlocked() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        demand.refund(id);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
    }

    function test_GlobalEscrowAccountingAcrossDemands() public {
        uint256 first = _create(alice, 50_000);
        vm.prank(bob);
        uint256 second =
            demand.createDemand("invoice-parser", "json invoice parser", 10_000, 1_000, _deadline(), 30_000);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(demand.totalEscrowed(), 80_000);
        assertEq(token.balanceOf(address(demand)), 80_000);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        demand.refund(first);
        assertEq(demand.totalEscrowed(), 30_000);
        assertEq(token.balanceOf(address(demand)), 30_000);
    }
}
