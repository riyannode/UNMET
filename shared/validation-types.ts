export const authorizationTypes = { BuilderValidationAuthorization: [
  { name: "demandId", type: "uint256" }, { name: "builderWallet", type: "address" },
  { name: "serviceUrlHash", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" },
  { name: "requestHash", type: "bytes32" }, { name: "paymentNetworkHash", type: "bytes32" },
  { name: "authorizedPayTo", type: "address" }, { name: "submissionNonce", type: "uint256" },
  { name: "issuedAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
] } as const;
export const attestationTypes = { ValidationAttestation: [
  { name: "escrowChainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
  { name: "demandId", type: "uint256" }, { name: "builderWallet", type: "address" },
  { name: "serviceUrlHash", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" },
  { name: "paymentRequirementsHash", type: "bytes32" }, { name: "submissionNonce", type: "uint256" },
  { name: "validationPolicyId", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
] } as const;
