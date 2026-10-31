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

contract BlockedUSD is MockUSD {
    address public immutable blocked;

    constructor(address blocked_) {
        blocked = blocked_;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(to != blocked, "blocked");
        super._update(from, to, amount);
    }
}

contract HashHarness is AgentDemand {
    constructor(address token, address treasury, address verifier, address admin)
        AgentDemand(token, treasury, 200, 6000, 10_000, 1 days, verifier, admin)
    {}

    function hashes(ValidationAttestation calldata a) external view returns (bytes32, bytes32, bytes32, bytes32) {
        bytes32 structHash = _attestationStructHash(a);
        return (ATTESTATION_TYPEHASH, _domainSeparatorV4(), structHash, _hashTypedDataV4(structHash));
    }
}

contract CallbackUSD is MockUSD {
    address public target;
    bytes public callback;
    bool public attempted;
    bool public succeeded;
    bytes4 public callbackError;
    bool public chargeFee;

    function configure(address target_, bytes calldata callback_, bool fee_) external {
        target = target_;
        callback = callback_;
        chargeFee = fee_;
        attempted = false;
        succeeded = false;
        callbackError = bytes4(0);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (target != address(0) && from != address(0)) {
            attempted = true;
            bytes memory result;
            (succeeded, result) = target.call(callback);
            if (result.length >= 4) callbackError = bytes4(result);
        }
        if (chargeFee && from != address(0) && to != address(0)) {
            super._update(from, address(0), 1);
            super._update(from, to, amount - 1);
        } else {
            super._update(from, to, amount);
        }
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

    uint256 internal constant VERIFIER_KEY = 0x1234;
    address internal verifier = vm.addr(VERIFIER_KEY);
    address internal verifierAdmin = makeAddr("verifierAdmin");

    uint16 internal constant FEE_BPS = 200;
    uint16 internal constant QUORUM_BPS = 6000;
    uint96 internal constant MIN_COMMIT = 10_000;
    uint32 internal constant REVIEW = 24 hours;

    string internal constant CAP = "vendor-kyb-singapore";
    string internal constant SPEC = "legal entity status + ownership data + source URLs + JSON";

    function setUp() public {
        token = new MockUSD();
        demand =
            new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
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

    function _attestation(address who, uint256 id, string memory url, bytes32 evidence)
        internal
        view
        returns (AgentDemand.ValidationAttestation memory a)
    {
        a = AgentDemand.ValidationAttestation(
            block.chainid,
            address(demand),
            id,
            who,
            keccak256(bytes(url)),
            evidence,
            keccak256("payment"),
            demand.submissionNonce(id) + 1,
            keccak256("policy"),
            uint64(block.timestamp),
            uint64(block.timestamp + 900)
        );
    }

    function _digest(address escrow, AgentDemand.ValidationAttestation memory a) internal view returns (bytes32) {
        bytes32 typeHash = keccak256(
            "ValidationAttestation(uint256 escrowChainId,address verifyingContract,uint256 demandId,address builderWallet,bytes32 serviceUrlHash,bytes32 evidenceHash,bytes32 paymentRequirementsHash,uint256 submissionNonce,bytes32 validationPolicyId,uint64 issuedAt,uint64 expiresAt)"
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UNMET AgentDemand"),
                keccak256("2"),
                block.chainid,
                escrow
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(typeHash, a))));
    }

    function _sign(AgentDemand.ValidationAttestation memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(address(demand), a));
        return abi.encodePacked(r, s, v);
    }

    function _submit(address who, uint256 id, string memory url, bytes32 evidence) internal {
        AgentDemand.ValidationAttestation memory a = _attestation(who, id, url, evidence);
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.prank(who);
        demand.submitService(id, url, evidence, a, sig);
    }

    function test_ConstructorValidation() public {
        vm.expectRevert(AgentDemand.ZeroAddress.selector);
        new AgentDemand(address(0), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        vm.expectRevert(AgentDemand.ZeroAddress.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, address(0), verifierAdmin);
        vm.expectRevert(AgentDemand.ZeroAddress.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, address(0));
        vm.expectRevert(AgentDemand.InvalidFee.selector);
        new AgentDemand(address(token), treasury, 1001, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        vm.expectRevert(AgentDemand.InvalidQuorum.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, 5000, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        vm.expectRevert(AgentDemand.InvalidAmount.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, 0, REVIEW, verifier, verifierAdmin);
        vm.expectRevert(AgentDemand.InvalidDeadline.selector);
        new AgentDemand(address(token), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, 30 minutes, verifier, verifierAdmin);
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
        (uint96 amount, uint256 calls,,) = demand.getSupport(id, bob);
        assertEq(amount, 30_000);
        assertEq(calls, 1_000);
        assertEq(demand.totalEscrowed(), 100_000);
    }

    function test_QuorumUsesCeilingAndSnapshot() public {
        uint256 id = _create(alice, 10_001);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        AgentDemand.Demand memory d = demand.getDemand(id);
        assertEq(d.reviewCommitted, 10_001);
        assertEq(d.approvalRequired, 6_001);
    }

    function test_SupportBlockedWhileSubmitted() public {
        uint256 id = _create(alice, 50_000);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(bob);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.supportDemand(id, 30_000, 1);
    }

    function test_ApproveRejectAreMutuallyExclusive() public {
        uint256 id = _create(alice, 50_000);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.rejectService(id, 1);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.ConflictingVote.selector);
        demand.approveService(id, 1);
    }

    function test_MathematicalRejectionAllowsEarlyReopen() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 30_000, 1);
        vm.prank(carol);
        demand.supportDemand(id, 20_000, 1);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));

        // 60k approval required; >40k rejection makes quorum impossible.
        vm.prank(alice);
        demand.rejectService(id, 1);
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
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1); // 50k < fixed 60k
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
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        vm.prank(bob);
        demand.approveService(id, 1);

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
        _submit(bob, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(bob);
        demand.approveService(id, 1);
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
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        demand.finalize(id);
        assertFalse(demand.isRefundable(id, alice));
    }

    function test_StaleApprovalAndRejectionDoNotSurviveReopen() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 50_000, 1);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev1"));
        vm.prank(alice);
        demand.approveService(id, 1);
        uint256 firstNonce = demand.submissionNonce(id);

        vm.warp(block.timestamp + REVIEW + 1);
        demand.reopen(id);
        assertEq(demand.approvalWeight(id), 0);
        assertEq(demand.rejectionWeight(id), 0);

        _submit(builder, id, "https://svc.example/kyb2", keccak256("ev2"));
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
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1); // 50k < 60k
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

    function test_GoldenVectorUsesProductionHash() public {
        vm.chainId(1952);
        HashHarness harness = new HashHarness(address(token), treasury, verifier, verifierAdmin);
        address fixture = 0x1111111111111111111111111111111111111111;
        vm.etch(fixture, address(harness).code);
        AgentDemand.ValidationAttestation memory a = AgentDemand.ValidationAttestation({
            escrowChainId: 1952,
            verifyingContract: fixture,
            demandId: 9007199254740993,
            builderWallet: 0x2222222222222222222222222222222222222222,
            serviceUrlHash: 0xeebff726b9796bc70b7b17226d7f6fe9d11fb311d21a7eb11662c45cb2283e81,
            evidenceHash: 0xef49c6e023e5910e309c7ce7e15902489f2828504016ac4f765edb049e757d48,
            paymentRequirementsHash: 0xce3247c6f8737f0713bb03c15354865a14ead04210ca05d7578752d095175d49,
            submissionNonce: 1,
            validationPolicyId: 0xe0067e7f39455d7a4b9587fa4b197a61d0e2aaf308650960b88e902cfbd2a691,
            issuedAt: 1792886400,
            expiresAt: 1792887300
        });
        (bytes32 typ, bytes32 domain, bytes32 structure, bytes32 digest) = HashHarness(fixture).hashes(a);
        assertEq(typ, 0x67beb001f81b85e71e91091bf36753e1a578fbec204642b1bee40134161f22dd);
        assertEq(domain, 0x5f4cb5a0f9b354d673e444109a9e548a6103bf9b43c23fc3a00f329c0e2fb42a);
        assertEq(structure, 0x57d9261a3e04d73fc8c39e6d110b718b839c7816a76830d61ac2ff951e53927d);
        assertEq(digest, 0x2917ee6a3d428ef2088a6f96d9873f46dbba4cf3da8c9cd75a3b0dd2ec284301);
    }

    function _expectInvalid(uint256 id, AgentDemand.ValidationAttestation memory a, bytes memory sig) internal {
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), a, sig);
        assertEq(demand.submissionNonce(id), 0);
    }

    function test_AttestationBindingsAndSignature() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory base =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        bytes memory sig = _sign(base, VERIFIER_KEY);
        _expectInvalid(id, base, "");
        _expectInvalid(id, base, hex"1234");
        _expectInvalid(id, base, _sign(base, 0x5678));
        bytes memory malformed = _sign(base, VERIFIER_KEY);
        malformed[64] = 0x1d;
        _expectInvalid(id, base, malformed);
        bytes32 r;
        bytes32 lowS;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 32))
            lowS := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        uint256 highS = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(lowS);
        _expectInvalid(id, base, abi.encodePacked(r, bytes32(highS), v == 27 ? uint8(28) : uint8(27)));
        for (uint256 i; i < 11; ++i) {
            AgentDemand.ValidationAttestation memory a =
                _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
            if (i == 0) a.escrowChainId++;
            if (i == 1) a.verifyingContract = alice;
            if (i == 2) a.demandId++;
            if (i == 3) a.builderWallet = alice;
            if (i == 4) a.serviceUrlHash = bytes32(uint256(1));
            if (i == 5) a.evidenceHash = bytes32(uint256(1));
            if (i == 6) a.paymentRequirementsHash = bytes32(uint256(1));
            if (i == 7) a.submissionNonce++;
            if (i == 8) a.validationPolicyId = bytes32(uint256(1));
            if (i == 9) a.issuedAt++;
            if (i == 10) a.expiresAt--;
            _expectInvalid(id, a, sig);
        }
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), base, sig);
        assertEq(demand.submissionNonce(id), 1);
        (bytes32 payment, bytes32 policy) = demand.submissionDigests(id, 1);
        assertEq(payment, keccak256("payment"));
        assertEq(policy, keccak256("policy"));
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), base, sig);
        (bool ok,) = address(demand)
            .call(abi.encodeWithSignature("submitService(uint256,string,bytes32)", id, "url", keccak256("ev")));
        assertFalse(ok);
    }

    function test_TimeBoundaries() public {
        vm.warp(10000);
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory a =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        a.issuedAt = 10061;
        a.expiresAt = 10961;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.issuedAt = 10000;
        a.expiresAt = 10901;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.issuedAt = 9999;
        a.expiresAt = 10000;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.issuedAt = 10000;
        a.expiresAt = 10000;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.issuedAt = 10001;
        a.expiresAt = 10000;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.issuedAt = 10060;
        a.expiresAt = 10961;
        _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        a.expiresAt = 10960;
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), a, sig);
    }

    function test_ReopenReplayDigestsAndRotation() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory old =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        bytes memory oldSig = _sign(old, VERIFIER_KEY);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), old, oldSig);
        vm.prank(alice);
        demand.rejectService(id, 1);
        uint64 deadline = demand.getDemand(id).deadline;
        vm.prank(verifierAdmin);
        demand.setVerifier(vm.addr(0x5678));
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Submitted));
        demand.reopen(id);
        assertEq(demand.getDemand(id).deadline, deadline);
        assertEq(demand.submissionNonce(id), 1);
        (bytes32 payment, bytes32 policy) = demand.submissionDigests(id, 1);
        assertEq(payment, keccak256("payment"));
        assertEq(policy, keccak256("policy"));
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), old, oldSig);
        AgentDemand.ValidationAttestation memory next =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), next, _sign(next, VERIFIER_KEY));
        bytes memory sig = _sign(next, 0x5678);
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), next, sig);
        assertEq(demand.submissionNonce(id), 2);
        (,,, bool rejected) = demand.getSupport(id, alice);
        assertFalse(rejected);
        vm.prank(alice);
        demand.approveService(id, 2);
        demand.finalize(id);
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Fulfilled));
    }

    function test_AuthorityAndLateSubmission() public {
        vm.prank(alice);
        vm.expectRevert(AgentDemand.Unauthorized.selector);
        demand.setVerifier(alice);
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.ZeroAddress.selector);
        demand.setVerifier(address(0));
        uint256 id = _create(alice, 50_000);
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.finalize(id);
        vm.warp(block.timestamp + 8 days);
        AgentDemand.ValidationAttestation memory a =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.prank(builder);
        vm.expectRevert(AgentDemand.DeadlinePassed.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), a, sig);
        vm.prank(alice);
        demand.refund(id);
    }

    function test_CallbackAndExactTransferRollback() public {
        CallbackUSD bad = new CallbackUSD();
        AgentDemand target =
            new AgentDemand(address(bad), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        bad.mint(alice, 100_000);
        vm.prank(alice);
        bad.approve(address(target), type(uint256).max);
        bad.configure(address(target), abi.encodeCall(target.reopen, (1)), true);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.UnsupportedToken.selector);
        target.createDemand(CAP, SPEC, 20_000, 1, _deadline(), 50_000);
        assertEq(target.nextDemandId(), 1);
        assertEq(target.totalEscrowed(), 0);
        bad.configure(address(target), abi.encodeCall(target.approveService, (1, 1)), false);
        vm.prank(alice);
        target.createDemand(CAP, SPEC, 20_000, 1, _deadline(), 50_000);
        assertTrue(bad.attempted());
        assertFalse(bad.succeeded());
        assertEq(bad.callbackError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(target.totalEscrowed(), 50_000);
        vm.warp(block.timestamp + 8 days);
        bad.configure(address(target), abi.encodeCall(target.refund, (1)), false);
        vm.prank(alice);
        target.refund(1);
        assertTrue(bad.attempted());
        assertFalse(bad.succeeded());
        assertEq(bad.callbackError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(target.totalEscrowed(), 0);
        assertEq(bad.balanceOf(address(target)), 0);
    }

    function testFuzz_QuorumCeiling(uint96 value) public {
        uint96 amount = uint96(bound(value, MIN_COMMIT, 2_000_000));
        uint256 id = _create(alice, amount);
        _submit(builder, id, "https://svc.example/kyb", keccak256("ev"));
        assertEq(demand.getDemand(id).approvalRequired, (uint256(amount) * QUORUM_BPS + 9999) / 10000);
    }

    function test_OutgoingTransferRollbackAndReentrancy() public {
        CallbackUSD bad = new CallbackUSD();
        AgentDemand target =
            new AgentDemand(address(bad), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        bad.mint(alice, 50_000);
        vm.prank(alice);
        bad.approve(address(target), type(uint256).max);
        vm.prank(alice);
        target.createDemand(CAP, SPEC, 20_000, 1, _deadline(), 50_000);
        AgentDemand.ValidationAttestation memory a = AgentDemand.ValidationAttestation(
            block.chainid,
            address(target),
            1,
            builder,
            keccak256(bytes("url")),
            keccak256("ev"),
            keccak256("payment"),
            1,
            keccak256("policy"),
            uint64(block.timestamp),
            uint64(block.timestamp + 900)
        );
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(VERIFIER_KEY, _digest(address(target), a));
        vm.prank(builder);
        target.submitService(1, "url", keccak256("ev"), a, abi.encodePacked(r, sigS, v));
        vm.prank(alice);
        target.approveService(1, 1);
        bad.configure(address(target), abi.encodeCall(target.finalize, (1)), true);
        vm.expectRevert(AgentDemand.UnsupportedToken.selector);
        target.finalize(1);
        assertEq(target.totalEscrowed(), 50_000);
        assertEq(bad.balanceOf(address(target)), 50_000);
        assertEq(uint8(target.getDemand(1).status), uint8(AgentDemand.Status.Submitted));
        bad.configure(address(target), abi.encodeCall(target.finalize, (1)), false);
        target.finalize(1);
        assertTrue(bad.attempted());
        assertFalse(bad.succeeded());
        assertEq(bad.callbackError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(target.totalEscrowed(), 0);
        assertEq(bad.balanceOf(address(target)), 0);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        target.finalize(1);
    }

    function testFuzz_SelectiveSettlement(uint96 a, uint96 b) public {
        uint96 approved = uint96(bound(a, 15_000, 1_000_000));
        uint96 remaining = uint96(bound(b, 10_000, uint256(approved) * 2 / 3));
        uint256 id = _create(alice, approved);
        vm.prank(bob);
        demand.supportDemand(id, remaining, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        uint256 beforeBuilder = token.balanceOf(builder);
        uint256 beforeTreasury = token.balanceOf(treasury);
        demand.finalize(id);
        uint256 fee = uint256(approved) * FEE_BPS / 10000;
        assertEq(token.balanceOf(builder) - beforeBuilder, approved - fee);
        assertEq(token.balanceOf(treasury) - beforeTreasury, fee);
        assertEq(demand.totalEscrowed(), remaining);
        vm.prank(bob);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(demand)), 0);
    }

    function test_RejectionAllowsRefundAtDeadlineBeforeReviewEnds() public {
        vm.prank(alice);
        uint256 id = demand.createDemand(CAP, SPEC, 20_000, 1, uint64(block.timestamp + 1 hours), 50_000);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.rejectService(id, 1);
        vm.warp(block.timestamp + 1 hours);
        assertLt(block.timestamp, demand.getDemand(id).reviewEndsAt);
        vm.prank(alice);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
    }

    function test_SignedBindingViolationsAndExactUrlBytes() public {
        uint256 id = _create(alice, 50_000);
        for (uint256 i; i < 7; ++i) {
            AgentDemand.ValidationAttestation memory a =
                _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
            if (i == 0) a.escrowChainId++;
            if (i == 1) a.verifyingContract = alice;
            if (i == 2) a.demandId++;
            if (i == 3) a.builderWallet = alice;
            if (i == 4) a.serviceUrlHash = keccak256("https://svc.example/kyb/");
            if (i == 5) a.evidenceHash = keccak256("other");
            if (i == 6) a.submissionNonce++;
            _expectInvalid(id, a, _sign(a, VERIFIER_KEY));
        }
        AgentDemand.ValidationAttestation memory good =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        bytes memory sig = _sign(good, VERIFIER_KEY);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), good, sig);
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "https://svc.example/kyb/", keccak256("ev"), good, sig);
        assertEq(demand.submissionNonce(id), 0);
    }

    function test_ReplaySameVerifierAndHistoricalDigests() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory first = _attestation(builder, id, "url", keccak256("ev"));
        bytes memory sig = _sign(first, VERIFIER_KEY);
        vm.prank(builder);
        demand.submitService(id, "url", keccak256("ev"), first, sig);
        vm.prank(alice);
        demand.rejectService(id, 1);
        demand.reopen(id);
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "url", keccak256("ev"), first, sig);
        assertEq(demand.submissionNonce(id), 1);
        assertTrue(demand.hasRejected(id, 1, alice));
        AgentDemand.ValidationAttestation memory second = _attestation(builder, id, "url", keccak256("ev"));
        second.paymentRequirementsHash = keccak256("payment2");
        second.validationPolicyId = keccak256("policy2");
        bytes memory secondSig = _sign(second, VERIFIER_KEY);
        vm.prank(builder);
        demand.submitService(id, "url", keccak256("ev"), second, secondSig);
        assertEq(demand.submissionNonce(id), 2);
        assertTrue(demand.hasRejected(id, 1, alice));
        assertFalse(demand.hasRejected(id, 2, alice));
        (bytes32 payment, bytes32 policy) = demand.submissionDigests(id, 1);
        assertEq(payment, first.paymentRequirementsHash);
        assertEq(policy, first.validationPolicyId);
        (payment, policy) = demand.submissionDigests(id, 2);
        assertEq(payment, second.paymentRequirementsHash);
        assertEq(policy, second.validationPolicyId);
    }

    function testFuzz_NonceMonotonic(uint8 value) public {
        uint256 rounds = bound(value, 1, 5);
        uint256 id = _create(alice, 50_000);
        for (uint256 i; i < rounds; ++i) {
            _submit(builder, id, "url", keccak256("ev"));
            assertEq(demand.submissionNonce(id), i + 1);
            vm.prank(alice);
            demand.rejectService(id, i + 1);
            demand.reopen(id);
            assertEq(demand.submissionNonce(id), i + 1);
        }
    }

    function test_ExactQuorumImmediateSettlement() public {
        uint256 id = _create(alice, 60_000);
        vm.prank(bob);
        demand.supportDemand(id, 40_000, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.QuorumNotReached.selector);
        demand.finalize(id);
        vm.prank(alice);
        demand.approveService(id, 1);
        assertEq(demand.approvalWeight(id), 60_000);
        uint256 beforeBuilder = token.balanceOf(builder);
        uint256 beforeTreasury = token.balanceOf(treasury);
        demand.finalize(id);
        assertEq(token.balanceOf(builder) - beforeBuilder, 58_800);
        assertEq(token.balanceOf(treasury) - beforeTreasury, 1_200);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.finalize(id);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
        vm.prank(bob);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
    }

    function test_RotationPreservesAcceptedStateAndRights() public {
        uint256 id = _create(alice, 60_000);
        vm.prank(bob);
        demand.supportDemand(id, 40_000, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        AgentDemand.Demand memory beforeRotation = demand.getDemand(id);
        vm.expectEmit(true, true, false, true, address(demand));
        emit VerifierRotated(verifier, carol);
        vm.prank(verifierAdmin);
        demand.setVerifier(carol);
        AgentDemand.Demand memory afterRotation = demand.getDemand(id);
        assertEq(afterRotation.builder, beforeRotation.builder);
        assertEq(afterRotation.serviceUrl, beforeRotation.serviceUrl);
        assertEq(afterRotation.evidenceHash, beforeRotation.evidenceHash);
        assertEq(afterRotation.reviewEndsAt, beforeRotation.reviewEndsAt);
        assertEq(afterRotation.reviewCommitted, beforeRotation.reviewCommitted);
        assertEq(afterRotation.approvalRequired, beforeRotation.approvalRequired);
        assertEq(afterRotation.deadline, beforeRotation.deadline);
        assertEq(demand.approvalWeight(id), 60_000);
        assertTrue(demand.hasApproved(id, 1, alice));
        demand.finalize(id);
        vm.prank(bob);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
    }

    event VerifierRotated(address indexed previousVerifier, address indexed newVerifier);
    event ServiceSubmitted(
        uint256 indexed demandId,
        uint256 indexed submissionNonce,
        address indexed builder,
        string serviceUrl,
        bytes32 evidenceHash,
        uint64 reviewEndsAt,
        uint128 reviewCommitted,
        uint128 approvalRequired,
        bytes32 paymentRequirementsHash,
        bytes32 validationPolicyId
    );

    function test_SubmissionEventAndDomain() public {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address contractAddress,
            bytes32 salt,
            uint256[] memory extensions
        ) = demand.eip712Domain();
        assertEq(fields, bytes1(0x0f));
        assertEq(name, "UNMET AgentDemand");
        assertEq(version, "2");
        assertEq(chainId, block.chainid);
        assertEq(contractAddress, address(demand));
        assertEq(salt, bytes32(0));
        assertEq(extensions.length, 0);
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory a = _attestation(builder, id, "url", keccak256("ev"));
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.expectEmit(true, true, true, true, address(demand));
        emit ServiceSubmitted(
            id,
            1,
            builder,
            "url",
            keccak256("ev"),
            uint64(block.timestamp) + REVIEW,
            50_000,
            30_000,
            a.paymentRequirementsHash,
            a.validationPolicyId
        );
        vm.prank(builder);
        demand.submitService(id, "url", keccak256("ev"), a, sig);
    }

    function test_ChainChangeInvalidatesOldDomainSignature() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory a = _attestation(builder, id, "url", keccak256("ev"));
        a.escrowChainId = block.chainid + 1;
        bytes memory oldSig = _sign(a, VERIFIER_KEY);
        vm.chainId(block.chainid + 1);
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidAttestation.selector);
        demand.submitService(id, "url", keccak256("ev"), a, oldSig);
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.prank(builder);
        demand.submitService(id, "url", keccak256("ev"), a, sig);
    }

    function test_CanonicalSignatureVariants() public {
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory a =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        bytes memory sig = _sign(a, VERIFIER_KEY);
        bytes32 r;
        bytes32 lowS;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 32))
            lowS := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        _expectInvalid(id, a, abi.encodePacked(r, lowS));
        _expectInvalid(id, a, new bytes(65));
        _expectInvalid(id, a, abi.encodePacked(r, lowS, uint8(0)));
        _expectInvalid(id, a, abi.encodePacked(r, lowS, uint8(1)));
        _expectInvalid(id, a, abi.encodePacked(r, lowS, uint8(29)));
        bytes32 highS = bytes32(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(lowS));
        bytes32 digest = _digest(address(demand), a);
        uint8 flipped = v == 27 ? 28 : 27;
        assertEq(ecrecover(digest, flipped, r, highS), verifier);
        _expectInvalid(id, a, abi.encodePacked(r, highS, flipped));
    }

    function testFuzz_AttestationTime(uint16 offset, uint16 lifetime) public {
        vm.warp(100000);
        uint256 id = _create(alice, 50_000);
        AgentDemand.ValidationAttestation memory a =
            _attestation(builder, id, "https://svc.example/kyb", keccak256("ev"));
        a.issuedAt = uint64(block.timestamp + bound(offset, 0, 80));
        a.expiresAt = uint64(uint256(a.issuedAt) + bound(lifetime, 0, 920));
        bytes memory sig = _sign(a, VERIFIER_KEY);
        bool valid = a.issuedAt <= block.timestamp + 60 && a.expiresAt > a.issuedAt && a.expiresAt - a.issuedAt <= 900
            && a.expiresAt > block.timestamp;
        if (!valid) {
            _expectInvalid(id, a, sig);
            return;
        }
        vm.prank(builder);
        demand.submitService(id, "https://svc.example/kyb", keccak256("ev"), a, sig);
        assertEq(demand.submissionNonce(id), 1);
    }

    function test_AuthorityNoEscrowPowers() public {
        uint256 id = _create(alice, 50_000);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(verifier);
        vm.expectRevert(AgentDemand.NotSupporter.selector);
        demand.approveService(id, 1);
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.NotSupporter.selector);
        demand.approveService(id, 1);
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.QuorumNotReached.selector);
        demand.finalize(id);
        vm.warp(block.timestamp + 8 days);
        vm.prank(verifierAdmin);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
        vm.prank(verifier);
        (bool ok,) = address(demand).call(abi.encodeWithSignature("withdraw()"));
        assertFalse(ok);
        vm.prank(verifierAdmin);
        (ok,) = address(demand).call(abi.encodeWithSignature("rescueFunds()"));
        assertFalse(ok);
        vm.prank(verifierAdmin);
        (ok,) = address(demand).call(abi.encodeWithSignature("forceFinalize(uint256)", id));
        assertFalse(ok);
        assertEq(demand.totalEscrowed(), 50_000);
    }

    function test_RepeatSupportAndExactDeadline() public {
        vm.prank(alice);
        uint256 id = demand.createDemand(CAP, SPEC, 20_000, 1, uint64(block.timestamp + 1 hours), 50_000);
        vm.prank(alice);
        demand.supportDemand(id, 10_000, 2);
        assertEq(demand.getDemand(id).supporterCount, 1);
        assertEq(demand.getDemand(id).committed, 60_000);
        assertEq(demand.expectedCallsOf(id, alice), 3);
        vm.warp(block.timestamp + 1 hours - 1);
        AgentDemand.ValidationAttestation memory a = _attestation(builder, id, "url", keccak256("ev"));
        bytes memory sig = _sign(a, VERIFIER_KEY);
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.DeadlinePassed.selector);
        demand.supportDemand(id, 10_000, 1);
        vm.prank(builder);
        vm.expectRevert(AgentDemand.DeadlinePassed.selector);
        demand.submitService(id, "url", keccak256("ev"), a, sig);
        vm.prank(alice);
        demand.refund(id);
    }

    function test_ReopenAtExactDeadlineRejected() public {
        vm.prank(alice);
        uint256 id = demand.createDemand(CAP, SPEC, 20_000, 1, uint64(block.timestamp + 1 hours), 50_000);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.rejectService(id, 1);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(AgentDemand.DeadlinePassed.selector);
        demand.reopen(id);
    }

    function test_JustBelowQuorumCannotFinalize() public {
        uint256 id = _create(alice, 49_999);
        vm.prank(bob);
        demand.supportDemand(id, 10_000, 1);
        vm.prank(carol);
        demand.supportDemand(id, 40_001, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        vm.prank(bob);
        demand.approveService(id, 1);
        assertEq(demand.approvalWeight(id), 59_999);
        assertEq(demand.getDemand(id).approvalRequired, 60_000);
        vm.expectRevert(AgentDemand.QuorumNotReached.selector);
        demand.finalize(id);
    }

    function test_DuplicateVotesAndApprovalThenRejection() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 50_000, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.AlreadyApproved.selector);
        demand.approveService(id, 1);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.ConflictingVote.selector);
        demand.rejectService(id, 1);
        vm.prank(bob);
        demand.rejectService(id, 1);
        vm.prank(bob);
        vm.expectRevert(AgentDemand.AlreadyRejected.selector);
        demand.rejectService(id, 1);
        assertEq(demand.approvalWeight(id), 50_000);
        assertEq(demand.rejectionWeight(id), 50_000);
    }

    function test_RefundWaitsForLateReviewWithoutQuorum() public {
        vm.prank(alice);
        uint256 id = demand.createDemand(CAP, SPEC, 20_000, 1, uint64(block.timestamp + 1 hours), 50_000);
        vm.warp(block.timestamp + 59 minutes);
        _submit(builder, id, "url", keccak256("ev"));
        AgentDemand.Demand memory d = demand.getDemand(id);
        vm.warp(d.deadline);
        assertFalse(demand.isRefundable(id, alice));
        vm.prank(alice);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
        vm.warp(d.reviewEndsAt);
        assertTrue(demand.isRefundable(id, alice));
        vm.prank(alice);
        demand.refund(id);
        assertEq(demand.totalEscrowed(), 0);
    }

    function test_CumulativeCallsExceedUint64() public {
        vm.prank(alice);
        uint256 id = demand.createDemand(CAP, SPEC, 20_000, type(uint64).max, _deadline(), MIN_COMMIT);
        vm.prank(alice);
        demand.supportDemand(id, MIN_COMMIT, type(uint64).max);
        vm.prank(bob);
        demand.supportDemand(id, MIN_COMMIT, type(uint64).max);
        assertEq(demand.expectedCallsOf(id, alice), uint256(type(uint64).max) * 2);
        assertEq(demand.getDemand(id).expectedCalls, uint256(type(uint64).max) * 3);
        uint256 bobBalance = token.balanceOf(bob);
        vm.prank(bob);
        vm.expectRevert(AgentDemand.InvalidExpectedCalls.selector);
        demand.supportDemand(id, MIN_COMMIT, 0);
        assertEq(demand.commitmentOf(id, bob), MIN_COMMIT);
        assertEq(demand.expectedCallsOf(id, bob), type(uint64).max);
        assertEq(demand.getDemand(id).committed, 3 * MIN_COMMIT);
        assertEq(demand.getDemand(id).expectedCalls, uint256(type(uint64).max) * 3);
        assertEq(demand.getDemand(id).supporterCount, 2);
        assertEq(token.balanceOf(bob), bobBalance);
        assertEq(token.balanceOf(address(demand)), 3 * MIN_COMMIT);
        assertEq(demand.totalEscrowed(), 3 * MIN_COMMIT);

        CallbackUSD bad = new CallbackUSD();
        demand =
            new AgentDemand(address(bad), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        bad.mint(alice, 100_000);
        bad.mint(bob, 100_000);
        vm.prank(alice);
        bad.approve(address(demand), type(uint256).max);
        vm.prank(bob);
        bad.approve(address(demand), type(uint256).max);
        vm.prank(alice);
        id = demand.createDemand(CAP, SPEC, 20_000, type(uint64).max, _deadline(), MIN_COMMIT);
        bad.configure(address(0), "", true);
        vm.prank(bob);
        vm.expectRevert(AgentDemand.UnsupportedToken.selector);
        demand.supportDemand(id, MIN_COMMIT, type(uint64).max);
        assertEq(demand.commitmentOf(id, bob), 0);
        assertEq(demand.expectedCallsOf(id, bob), 0);
        assertEq(demand.getDemand(id).committed, MIN_COMMIT);
        assertEq(demand.getDemand(id).expectedCalls, type(uint64).max);
        assertEq(demand.getDemand(id).supporterCount, 1);
        assertEq(bad.balanceOf(bob), 100_000);
        assertEq(bad.balanceOf(address(demand)), MIN_COMMIT);
        assertEq(demand.totalEscrowed(), MIN_COMMIT);
    }

    function test_StaleVoteBytesCannotVoteOnNextSubmission() public {
        uint256 id = _create(alice, 50_000);
        vm.prank(bob);
        demand.supportDemand(id, 50_000, 1);
        _submit(builder, id, "url1", keccak256("ev1"));
        bytes memory oldApprove = abi.encodeCall(demand.approveService, (id, 1));
        bytes memory oldReject = abi.encodeCall(demand.rejectService, (id, 1));
        vm.prank(bob);
        demand.rejectService(id, 1);
        demand.reopen(id);
        _submit(bob, id, "url2", keccak256("ev2"));
        vm.prank(alice);
        (bool ok, bytes memory result) = address(demand).call(oldApprove);
        assertFalse(ok);
        assertEq(bytes4(result), AgentDemand.SubmissionNonceMismatch.selector);
        vm.prank(alice);
        (ok, result) = address(demand).call(oldReject);
        assertFalse(ok);
        assertEq(bytes4(result), AgentDemand.SubmissionNonceMismatch.selector);
        assertEq(demand.approvalWeight(id), 0);
        assertEq(demand.rejectionWeight(id), 0);
        uint256 snapshot = vm.snapshotState();
        vm.prank(alice);
        demand.rejectService(id, 2);
        assertEq(demand.rejectionWeight(id), 50_000);
        vm.revertToState(snapshot);
        vm.prank(alice);
        demand.approveService(id, 2);
        assertEq(demand.approvalWeight(id), 50_000);
    }

    function test_CancelSettlementGraceAndRefunds() public {
        uint256 id = _create(alice, 60_000);
        vm.prank(bob);
        demand.supportDemand(id, 40_000, 1);
        _submit(builder, id, "url", keccak256("ev"));
        vm.expectRevert(AgentDemand.QuorumNotReached.selector);
        demand.cancelSettlement(id);
        vm.prank(alice);
        demand.approveService(id, 1);
        uint256 boundary = uint256(demand.getDemand(id).reviewEndsAt) + 7 days;
        vm.warp(boundary - 1);
        vm.expectRevert(AgentDemand.SettlementGraceActive.selector);
        demand.cancelSettlement(id);
        uint256 snapshot = vm.snapshotState();
        demand.finalize(id);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.cancelSettlement(id);
        vm.revertToState(snapshot);
        vm.warp(boundary);
        vm.expectRevert(AgentDemand.SettlementGraceExpired.selector);
        demand.finalize(id);
        uint256 atBoundary = vm.snapshotState();
        vm.warp(boundary + 1);
        vm.expectRevert(AgentDemand.SettlementGraceExpired.selector);
        demand.finalize(id);
        demand.cancelSettlement(id);
        vm.revertToState(atBoundary);
        vm.prank(carol);
        demand.cancelSettlement(id);
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Cancelled));
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.cancelSettlement(id);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.finalize(id);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.reopen(id);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.supportDemand(id, MIN_COMMIT, 1);
        AgentDemand.ValidationAttestation memory empty;
        vm.prank(builder);
        vm.expectRevert(AgentDemand.InvalidStatus.selector);
        demand.submitService(id, "url", keccak256("ev"), empty, "");
        _create(carol, MIN_COMMIT);
        uint256 replacement = demand.activeDemandByKey(_key());
        vm.prank(alice);
        demand.refund(id);
        vm.prank(alice);
        vm.expectRevert(AgentDemand.NothingToRefund.selector);
        demand.refund(id);
        vm.warp(boundary + 1);
        vm.prank(bob);
        demand.refund(id);
        assertEq(uint8(demand.getDemand(id).status), uint8(AgentDemand.Status.Cancelled));
        assertEq(demand.activeDemandByKey(_key()), replacement);
        assertGe(token.balanceOf(address(demand)), demand.totalEscrowed());
    }

    function test_BlockedBuilderAndTreasuryAllowCancellation() public {
        for (uint256 i; i < 2; ++i) {
            address blocked = i == 0 ? builder : treasury;
            BlockedUSD bad = new BlockedUSD(blocked);
            demand = new AgentDemand(
                address(bad), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin
            );
            bad.mint(alice, 100_000);
            bad.mint(bob, 100_000);
            vm.prank(alice);
            bad.approve(address(demand), type(uint256).max);
            vm.prank(bob);
            bad.approve(address(demand), type(uint256).max);
            uint256 id = _create(alice, 60_000);
            vm.prank(bob);
            demand.supportDemand(id, 40_000, 1);
            _submit(builder, id, "url", keccak256("ev"));
            vm.prank(alice);
            demand.approveService(id, 1);
            vm.expectRevert();
            demand.finalize(id);
            assertEq(demand.getDemand(id).committed, 100_000);
            assertEq(bad.balanceOf(builder), 0);
            assertEq(bad.balanceOf(treasury), 0);
            assertEq(bad.balanceOf(address(demand)), 100_000);
            assertEq(demand.totalEscrowed(), 100_000);
            vm.expectRevert();
            demand.finalize(id);
            vm.warp(uint256(demand.getDemand(id).reviewEndsAt) + 7 days);
            demand.cancelSettlement(id);
            vm.prank(alice);
            demand.refund(id);
            assertEq(bad.balanceOf(alice), 100_000);
            assertEq(demand.totalEscrowed(), 40_000);
            assertEq(bad.balanceOf(address(demand)), 40_000);
            vm.prank(bob);
            demand.refund(id);
            assertEq(bad.balanceOf(bob), 100_000);
            assertEq(demand.totalEscrowed(), 0);
            assertEq(bad.balanceOf(address(demand)), 0);
        }
    }

    function test_CancelledRefundRollbackAndReentrancy() public {
        CallbackUSD bad = new CallbackUSD();
        demand =
            new AgentDemand(address(bad), treasury, FEE_BPS, QUORUM_BPS, MIN_COMMIT, REVIEW, verifier, verifierAdmin);
        bad.mint(alice, 100_000);
        vm.prank(alice);
        bad.approve(address(demand), type(uint256).max);
        uint256 id = _create(alice, 60_000);
        _submit(builder, id, "url", keccak256("ev"));
        vm.prank(alice);
        demand.approveService(id, 1);
        vm.warp(uint256(demand.getDemand(id).reviewEndsAt) + 7 days);
        demand.cancelSettlement(id);
        bad.configure(address(demand), abi.encodeCall(demand.refund, (id)), true);
        vm.prank(alice);
        vm.expectRevert();
        demand.refund(id);
        assertEq(demand.commitmentOf(id, alice), 60_000);
        assertEq(demand.totalEscrowed(), 60_000);
        assertEq(bad.balanceOf(address(demand)), 60_000);
        bad.configure(address(demand), abi.encodeCall(demand.refund, (id)), false);
        vm.prank(alice);
        demand.refund(id);
        assertTrue(bad.attempted());
        assertFalse(bad.succeeded());
        assertEq(demand.totalEscrowed(), 0);
        assertEq(bad.balanceOf(address(demand)), 0);
    }
}
