import { hashTypedData, keccak256, recoverAddress, stringToHex, type Address, type Hex } from "viem";
import type { ParsedValidationRequest } from "./validation-evaluator";

export const authorizationTypes = { BuilderValidationAuthorization: [
  {name:"demandId",type:"uint256"},{name:"builderWallet",type:"address"},
  {name:"serviceUrlHash",type:"bytes32"},{name:"evidenceHash",type:"bytes32"},
  {name:"requestHash",type:"bytes32"},{name:"paymentNetworkHash",type:"bytes32"},
  {name:"authorizedPayTo",type:"address"},{name:"submissionNonce",type:"uint256"},
  {name:"issuedAt",type:"uint64"},{name:"expiresAt",type:"uint64"},
] } as const;
export const attestationTypes = { ValidationAttestation: [
  {name:"escrowChainId",type:"uint256"},{name:"verifyingContract",type:"address"},
  {name:"demandId",type:"uint256"},{name:"builderWallet",type:"address"},
  {name:"serviceUrlHash",type:"bytes32"},{name:"evidenceHash",type:"bytes32"},
  {name:"paymentRequirementsHash",type:"bytes32"},{name:"submissionNonce",type:"uint256"},
  {name:"validationPolicyId",type:"bytes32"},{name:"issuedAt",type:"uint64"},{name:"expiresAt",type:"uint64"},
] } as const;
export type Attestation = { escrowChainId:string; verifyingContract:string; demandId:string; builderWallet:string; serviceUrlHash:string; evidenceHash:string; paymentRequirementsHash:string; submissionNonce:string; validationPolicyId:string; issuedAt:string; expiresAt:string };
export const domain = (chain: string, contract: string) => ({name:"UNMET AgentDemand",version:"2",chainId:BigInt(chain),verifyingContract:contract as Address} as const);
export function authorizationDigest(parsed: ParsedValidationRequest): Hex {
  const i = parsed.input;
  return hashTypedData({domain:domain(i.escrowChainId,i.escrowContract),types:authorizationTypes,primaryType:"BuilderValidationAuthorization",message:{
    demandId:BigInt(i.demandId),builderWallet:i.builderWallet as Address,serviceUrlHash:keccak256(stringToHex(i.serviceUrl)),evidenceHash:i.evidenceHash as Hex,
    requestHash:parsed.requestHash,paymentNetworkHash:keccak256(stringToHex(i.paymentNetwork)),authorizedPayTo:i.authorizedPayTo as Address,
    submissionNonce:BigInt(i.submissionNonce),issuedAt:BigInt(i.builderAuthorization.issuedAt),expiresAt:BigInt(i.builderAuthorization.expiresAt),
  }});
}
export function attestationMessage(a: Attestation) {
  return {escrowChainId:BigInt(a.escrowChainId),verifyingContract:a.verifyingContract as Address,demandId:BigInt(a.demandId),builderWallet:a.builderWallet as Address,serviceUrlHash:a.serviceUrlHash as Hex,evidenceHash:a.evidenceHash as Hex,paymentRequirementsHash:a.paymentRequirementsHash as Hex,submissionNonce:BigInt(a.submissionNonce),validationPolicyId:a.validationPolicyId as Hex,issuedAt:BigInt(a.issuedAt),expiresAt:BigInt(a.expiresAt)};
}
export function attestationDigest(a: Attestation): Hex {
  return hashTypedData({domain:domain(a.escrowChainId,a.verifyingContract),types:attestationTypes,primaryType:"ValidationAttestation",message:attestationMessage(a)});
}
export function validTime(issued: bigint, expires: bigint, now: bigint): boolean {
  return issued <= now + 60n && issued < expires && expires - issued <= 900n && now < expires;
}
export function canonicalSignature(signature: string): signature is Hex {
  if (signature.length !== 132 || !/^0x[0-9a-f]{128}(1b|1c)$/.test(signature)) return false;
  const r = BigInt(`0x${signature.slice(2,66)}`), s = BigInt(`0x${signature.slice(66,130)}`);
  return r > 0n && r < 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n && s > 0n && s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
}
export async function signedBy(digest: Hex, signature: string, expected: string): Promise<boolean> {
  if (!canonicalSignature(signature)) return false;
  try { return (await recoverAddress({hash:digest,signature})).toLowerCase() === expected; } catch { return false; }
}
