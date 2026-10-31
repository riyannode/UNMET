export const AGENT_DEMAND_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "token_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "feeBps_",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "quorumBps_",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "minCommitment_",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "reviewPeriod_",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "verifier_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "verifierAdmin_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activeDemandByKey",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approvalProgress",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "weight",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "quorumReached",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approvalWeight",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approveService",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "commitmentOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "computeDemandKey",
    "inputs": [
      {
        "name": "capability",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "specification",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "createDemand",
    "inputs": [
      {
        "name": "capability",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "specification",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "maxUnitPrice",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "expectedCalls",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "initialCommitment",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "outputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "demandKeyOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expectedCallsOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalize",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getDemand",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AgentDemand.Demand",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "builder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "maxUnitPrice",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "committed",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "reviewCommitted",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "approvalRequired",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expectedCalls",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "reviewEndsAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "supporterCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum AgentDemand.Status"
          },
          {
            "name": "capability",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "specification",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "serviceUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getSupport",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "commitment",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "expectedCalls",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "approvedCurrentSubmission",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "rejectedCurrentSubmission",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasApproved",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasRejected",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isRefundable",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "minCommitment",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextDemandId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quorumBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refund",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectService",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectionProgress",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "weight",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "thresholdToBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "candidateRejected",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rejectionWeight",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reopen",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reviewPeriod",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setVerifier",
    "inputs": [
      {
        "name": "newVerifier",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submissionDigests",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "paymentRequirementsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "validationPolicyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "submissionNonce",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "submitService",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "serviceUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "attestation",
        "type": "tuple",
        "internalType": "struct AgentDemand.ValidationAttestation",
        "components": [
          {
            "name": "escrowChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifyingContract",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "demandId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "builderWallet",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "serviceUrlHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymentRequirementsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "submissionNonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validationPolicyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "verifierSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportDemand",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "expectedCalls",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalEscrowed",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifierAdmin",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "DemandClosed",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "demandKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DemandCreated",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "demandKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "capability",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "maxUnitPrice",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "expectedCalls",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "initialCommitment",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DemandFulfilled",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "builder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "treasury",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approvedAmount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "fee",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "payout",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "remainingRefundable",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DemandSupported",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "expectedCalls",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "committedTotal",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "supporterCount",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refunded",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ServiceApproved",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submissionNonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "weight",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "approvalWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ServiceRejected",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submissionNonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "supporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "weight",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "rejectionWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ServiceSubmitted",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submissionNonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "builder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "serviceUrl",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "reviewEndsAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "reviewCommitted",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "approvalRequired",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "paymentRequirementsHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "validationPolicyId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SubmissionRejected",
    "inputs": [
      {
        "name": "demandId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submissionNonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "builder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approvalWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "rejectionWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "approvalRequired",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VerifierRotated",
    "inputs": [
      {
        "name": "previousVerifier",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newVerifier",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyApproved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyRejected",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ConflictingVote",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DemandNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DuplicateDemand",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAttestation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCapability",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEvidence",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidExpectedCalls",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFee",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidQuorum",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTextLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSupporter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToRefund",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuorumNotReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReviewActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReviewEnded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;

export const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
