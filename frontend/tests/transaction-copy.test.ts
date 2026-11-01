import { describe, expect, test } from "bun:test";
import { ValidationResponseError } from "../errors";
import { transactionErrorNotice, transactionNotice, transactionSuccess } from "../transaction-copy";

describe("transaction copy", () => {
  test("distinguishes wallet rejection before send from completed token approval", () => {
    for (const error of [{ code: 4001 }, { cause: { cause: { code: 4001 } } }, new Error("WALLET_REJECTED")]) {
      expect(transactionErrorNotice(error).description).toBe("No transaction was sent.");
      expect(transactionErrorNotice(error).title).toBe("Cancelled in wallet");
    }
    for (const [actionId, action] of [["create", "demand"], ["create-demand", "demand"], ["support:1", "funding"]]) {
      expect(transactionErrorNotice({ code: 4001 }, { actionId, approvalCompleted: true }).description)
        .toBe("Token approval completed. The " + action + " transaction was not sent.");
    }
    expect(transactionErrorNotice(new Error("Provider disconnected")).description)
      .toBe("Check your wallet activity before trying again.");
  });

  test("pending and unknown explain why the action must not be repeated", () => {
    expect(transactionNotice("preparing")).toMatchObject({ title: "Preparing your request", description: "Check your wallet for prompts.", tone: "neutral" });
    expect(transactionNotice("broadcast")).toMatchObject({ title: "Transaction submitted", description: "Waiting for X Layer confirmation. Do not submit again.", tone: "neutral" });
    expect(transactionNotice("unknown")).toMatchObject({ title: "Transaction not verified yet", description: "Do not submit again. Verify the existing transaction first.", tone: "neutral" });
    expect(transactionNotice("approval-confirmed", "create-demand").description).toContain("The demand transaction was not sent.");
    expect(transactionNotice("checking")).toMatchObject({ title: "Checking existing transaction", tone: "neutral" });
  });

  test("confirmed transactions with unverified application state never look reverted or fully successful", () => {
    expect(transactionNotice("refresh-unavailable")).toMatchObject({ title: "Transaction confirmed", description: "Latest demand data is unavailable. Refresh before continuing.", tone: "neutral" });
    expect(transactionErrorNotice(new Error("SUBMISSION_READBACK_FAILED"))).toMatchObject({ title: "Transaction confirmed", description: "Proposal details are not verified yet. Do not submit again.", tone: "neutral" });
    expect(transactionSuccess("create-demand", false)).toMatchObject({ title: "Transaction confirmed", tone: "neutral" });
    expect(transactionNotice("reverted")).toMatchObject({ title: "Transaction failed on X Layer", description: "This action was not applied.", tone: "error" });
    expect(transactionNotice("cancelled")).toMatchObject({ title: "Transaction cancelled", description: "Your wallet replaced it with a cancellation.", tone: "neutral" });
  });

  test("known validation codes use curated reasons without raw server text", () => {
    const reasons = {
      INVALID_REQUEST: "Check the service URL and request details.",
      INVALID_JSON: "Check the service URL and request details.",
      INVALID_RESOURCE: "Check the service URL and request details.",
      INVALID_CHALLENGE: "The service did not return a valid x402 payment challenge.",
      INVALID_RESPONSE: "The service did not return a valid x402 payment challenge.",
      NO_ELIGIBLE_OFFER: "No payment offer meets this demand's requirements.",
      UNSUPPORTED_PRICE_COMPARISON: "The service payment asset does not match this demand's pricing.",
      INVALID_TARGET: "Use a public HTTPS service URL.",
      UNSAFE_ADDRESS: "Use a public HTTPS service URL.",
      INVALID_BUILDER_AUTHORIZATION: "Builder authorization could not be verified.",
      DEMAND_INELIGIBLE: "This demand changed or is not accepting proposals. Refresh it.",
      ENDPOINT_UNAVAILABLE: "The service endpoint could not be reached.",
      DNS_UNAVAILABLE: "The service endpoint could not be reached.",
      TRANSPORT_UNAVAILABLE: "The service endpoint could not be reached.",
      TRANSPORT_TIMEOUT: "The service endpoint could not be reached.",
    };
    for (const [code, reason] of Object.entries(reasons)) {
      const notice = transactionErrorNotice(new ValidationResponseError("FAIL", code));
      expect(notice).toMatchObject({ title: "Service validation failed", description: reason + " No transaction was sent.", tone: "error" });
    }
    for (const code of ["RPC_UNAVAILABLE", "SIGNER_UNAVAILABLE", "CAPACITY_EXHAUSTED", "REQUEST_TIMEOUT", "REQUEST_ABORTED", "INTERNAL_UNAVAILABLE"]) {
      expect(transactionErrorNotice(new ValidationResponseError("UNAVAILABLE", code)))
        .toMatchObject({ title: "Validation unavailable", description: "Try again later. No transaction was sent.", tone: "neutral" });
    }
    expect(transactionErrorNotice(new ValidationResponseError("UNAVAILABLE", "TRANSPORT_TIMEOUT")).title).toBe("Validation unavailable");
    expect(transactionErrorNotice(new ValidationResponseError("FAIL", "secret confirmed success FAILED")))
      .toMatchObject({ title: "Service validation failed", description: "Review the service request and try validation again. No transaction was sent.", tone: "error" });
  });

  test("unrecognized validator codes cannot select object prototype properties", () => {
    for (const code of ["toString", "constructor", "__proto__"]) {
      expect(transactionErrorNotice(new ValidationResponseError("FAIL", code)).description)
        .toBe("Review the service request and try validation again. No transaction was sent.");
    }
  });

  test("local validation and attestation failures remain clearly before transaction submission", () => {
    for (const code of ["VALIDATION_FAILED", "VALIDATION_INVALID_PASS", "VALIDATION_INVALID_SIGNATURE", "VALIDATION_INVALID_REQUEST", "VALIDATION_INVALID_PAYTO", "VALIDATION_EXPIRED", "VALIDATION_NONCE_STALE", "INVALID_JSON"]) {
      expect(transactionErrorNotice(new Error(code)).description).toContain("No transaction was sent.");
    }
    expect(transactionErrorNotice(new Error("DEMAND_INVALID_CAPABILITY")).description).toContain("Use letters and numbers");
    expect(transactionErrorNotice(new Error("VALIDATION_UNAVAILABLE")).title).toBe("Validation unavailable");
  });

  test("success copy names each completed action and keeps individual votes distinct", () => {
    const titles = {
      create: "Demand created", "create-demand": "Demand created", "support:1": "Funding added", "submit:1": "Service submitted",
      "approve:1:2": "Approval recorded", "reject:1:2": "Rejection recorded",
      "finalize:1": "Settlement complete", "cancel:1": "Settlement cancelled",
      "reopen:1": "Demand reopened", "refund:1": "Refund complete",
    };
    for (const [actionId, title] of Object.entries(titles)) expect(transactionSuccess(actionId)).toMatchObject({ title, tone: "success" });
    expect(transactionSuccess("approve:1:2").description).toBe("Your approval vote was recorded.");
    expect(transactionSuccess("reject:1:2").description).toBe("Your rejection vote was recorded.");
  });
});
