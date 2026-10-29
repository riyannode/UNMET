// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";

contract ValidationVectorsTest is Test {
    struct Authorization {
        uint256 demandId;
        address builderWallet;
        bytes32 serviceUrlHash;
        bytes32 evidenceHash;
        bytes32 requestHash;
        bytes32 paymentNetworkHash;
        address authorizedPayTo;
        uint256 submissionNonce;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct Attestation {
        uint256 escrowChainId;
        address verifyingContract;
        uint256 demandId;
        address builderWallet;
        bytes32 serviceUrlHash;
        bytes32 evidenceHash;
        bytes32 paymentRequirementsHash;
        uint256 submissionNonce;
        bytes32 validationPolicyId;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    function testPublishedTypedDataVectors() public view {
        string memory fixture = vm.readFile("fixtures/validation.json");
        Authorization memory a = Authorization({
            demandId: 9007199254740993,
            builderWallet: 0x2222222222222222222222222222222222222222,
            serviceUrlHash: 0xeebff726b9796bc70b7b17226d7f6fe9d11fb311d21a7eb11662c45cb2283e81,
            evidenceHash: 0xef49c6e023e5910e309c7ce7e15902489f2828504016ac4f765edb049e757d48,
            requestHash: vm.parseJsonBytes32(fixture, ".expected.requestHash"),
            paymentNetworkHash: keccak256("eip155:196"),
            authorizedPayTo: address(1),
            submissionNonce: 1,
            issuedAt: 1792886400,
            expiresAt: 1792887300
        });
        Attestation memory t = Attestation({
            escrowChainId: 1952,
            verifyingContract: 0x1111111111111111111111111111111111111111,
            demandId: a.demandId,
            builderWallet: a.builderWallet,
            serviceUrlHash: a.serviceUrlHash,
            evidenceHash: a.evidenceHash,
            paymentRequirementsHash: vm.parseJsonBytes32(fixture, ".expected.paymentRequirementsHash"),
            submissionNonce: a.submissionNonce,
            validationPolicyId: vm.parseJsonBytes32(fixture, ".expected.validationPolicyId"),
            issuedAt: a.issuedAt,
            expiresAt: a.expiresAt
        });
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UNMET AgentDemand"),
                keccak256("2"),
                uint256(1952),
                t.verifyingContract
            )
        );
        bytes32 authType = keccak256(
            "BuilderValidationAuthorization(uint256 demandId,address builderWallet,bytes32 serviceUrlHash,bytes32 evidenceHash,bytes32 requestHash,bytes32 paymentNetworkHash,address authorizedPayTo,uint256 submissionNonce,uint64 issuedAt,uint64 expiresAt)"
        );
        bytes32 attType = keccak256(
            "ValidationAttestation(uint256 escrowChainId,address verifyingContract,uint256 demandId,address builderWallet,bytes32 serviceUrlHash,bytes32 evidenceHash,bytes32 paymentRequirementsHash,uint256 submissionNonce,bytes32 validationPolicyId,uint64 issuedAt,uint64 expiresAt)"
        );
        assertEq(authType, vm.parseJsonBytes32(fixture, ".expected.authorizationTypeHash"));
        assertEq(attType, vm.parseJsonBytes32(fixture, ".expected.attestationTypeHash"));
        assertEq(
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("UNMET AgentDemand"),
                    keccak256("2"),
                    uint256(196),
                    t.verifyingContract
                )
            ),
            vm.parseJsonBytes32(fixture, ".expected.mainnetDomainSeparator")
        );
        assertEq(domain, vm.parseJsonBytes32(fixture, ".expected.domainSeparator"));
        assertEq(keccak256(abi.encode(authType, a)), vm.parseJsonBytes32(fixture, ".expected.authorizationStructHash"));
        assertEq(keccak256(abi.encode(attType, t)), vm.parseJsonBytes32(fixture, ".expected.attestationStructHash"));
        assertEq(
            keccak256(abi.encodePacked(hex"1901", domain, keccak256(abi.encode(authType, a)))),
            vm.parseJsonBytes32(fixture, ".expected.authorizationDigest")
        );
        assertEq(
            keccak256(abi.encodePacked(hex"1901", domain, keccak256(abi.encode(attType, t)))),
            vm.parseJsonBytes32(fixture, ".expected.attestationDigest")
        );
    }
}
