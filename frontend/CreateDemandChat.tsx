"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowRight, Pencil, RefreshCw } from "lucide-react";
import type { Hash } from "viem";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PromptInput } from "@/components/ui/prompt-input";
import {
  buildReviewRows,
  formatPriceUsage,
  parseCapabilityAnswer,
  parseCommitmentAnswer,
  parseDeadlineAnswer,
  parseExpectedCallsAnswer,
  parseMaximumPriceAnswer,
  parseSpecificationAnswer,
  resolveUniqueCreatedDemandId,
  updateEditedAnswer,
  validateAnswers,
  type CreateDemandAnswers,
  type CreatedDemandVerification,
  type DemandReadbackMatch,
  type EditableDemandField,
} from "@/create-demand-chat-model";
import type { createDemand } from "@/contract";
import { demandHref } from "@/routing";
import { explorerTx } from "@/contract";
import type { ReownStatus } from "@/reown-status";
import "./create-demand-chat.css";

type CreateDemandInput = Parameters<typeof createDemand>[0];

export type CreateDemandRunOutcome =
  | { kind: "confirmed"; hash: Hash; demandId: bigint | null; verification?: CreatedDemandVerification }
  | { kind: "readback-failed"; hash: Hash; message?: string; verification?: CreatedDemandVerification }
  | { kind: "failed"; message: string };

type ChatStep =
  | "capability"
  | "specification"
  | "pricing"
  | "commitment"
  | "deadline"
  | "review";

type ChatTurn = { speaker: "UNMET" | "You"; text: string };

type CreateDemandChatProps = {
  account: string | null;
  busy: boolean;
  contractConfigured: boolean;
  walletStatus: ReownStatus;
  onConnect: () => Promise<void>;
  onCreate: (input: CreateDemandInput) => Promise<CreateDemandRunOutcome>;
  onRefreshBoard: () => Promise<readonly DemandReadbackMatch[] | null>;
};

const EMPTY_ANSWERS: CreateDemandAnswers = {
  capability: "",
  capabilityLabel: "",
  specification: "",
  maxPrice: "",
  expectedCalls: "",
  commitment: "",
  deadlineDays: "",
};

const PROMPTS = {
  capability: "What service do you need?",
  specification: "What should the service provide?",
  pricing: "What's your max price per call, and how many calls do you expect?",
  commitment: "How much would you like to commit to escrow now?",
  deadline: "What's the deadline?",
} as const;

const EDIT_FIELDS: Array<{ field: EditableDemandField; label: string }> = [
  { field: "capability", label: "Service" },
  { field: "specification", label: "Specification" },
  { field: "maxPrice", label: "Maximum price per call" },
  { field: "expectedCalls", label: "Expected usage" },
  { field: "commitment", label: "Initial escrow" },
  { field: "deadlineDays", label: "Deadline" },
];

const EDIT_PROMPTS: Record<EditableDemandField, string> = {
  capability: "Update the service you need.",
  specification: "Update what the service should provide.",
  maxPrice: "Update the maximum price per call in USD₮0.",
  expectedCalls: "Update the expected number of calls.",
  commitment: "Update the initial escrow commitment in USD₮0.",
  deadlineDays: "Update the deadline in days.",
};

function buildTurns(
  answers: CreateDemandAnswers,
  step: ChatStep,
  editingField: EditableDemandField | null,
): ChatTurn[] {
  const turns: ChatTurn[] = [{ speaker: "UNMET", text: PROMPTS.capability }];
  if (!answers.capabilityLabel) return turns;
  turns.push({ speaker: "You", text: answers.capabilityLabel });
  turns.push({ speaker: "UNMET", text: PROMPTS.specification });
  if (!answers.specification) return turns;
  turns.push({ speaker: "You", text: answers.specification });

  turns.push({ speaker: "UNMET", text: PROMPTS.pricing });
  if (!answers.maxPrice || !answers.expectedCalls) return turns;
  turns.push({ speaker: "You", text: formatPriceUsage(answers.maxPrice, answers.expectedCalls) });
  turns.push({ speaker: "UNMET", text: PROMPTS.commitment });
  if (!answers.commitment) return turns;
  turns.push({ speaker: "You", text: `${answers.commitment} USD₮0` });
  turns.push({ speaker: "UNMET", text: PROMPTS.deadline });
  if (!answers.deadlineDays) return turns;
  turns.push({ speaker: "You", text: `${answers.deadlineDays} days` });
  turns.push({ speaker: "UNMET", text: "Review your demand" });
  if (editingField) turns.push({ speaker: "UNMET", text: EDIT_PROMPTS[editingField] });
  return turns;
}

function editValue(answers: CreateDemandAnswers, field: EditableDemandField): string {
  switch (field) {
    case "capability": return answers.capabilityLabel;
    case "specification": return answers.specification;
    case "maxPrice": return answers.maxPrice;
    case "expectedCalls": return answers.expectedCalls;
    case "commitment": return answers.commitment;
    case "deadlineDays": return `${answers.deadlineDays} days`;
  }
}

function editPreview(answers: CreateDemandAnswers, field: EditableDemandField): string {
  switch (field) {
    case "capability": return answers.capabilityLabel;
    case "specification": return answers.specification;
    case "maxPrice": return `${answers.maxPrice} USD₮0 / call`;
    case "expectedCalls": return `${new Intl.NumberFormat("en-US").format(BigInt(answers.expectedCalls))} calls`;
    case "commitment": return `${answers.commitment} USD₮0`;
    case "deadlineDays": return `${answers.deadlineDays} days`;
  }
}

function editPrompt(field: EditableDemandField | null, step: ChatStep): { label: string; placeholder: string } {
  if (field) {
    return {
      label: EDIT_PROMPTS[field],
      placeholder: field === "specification" ? "Describe the service requirements…" : "Update your answer",
    };
  }
  switch (step) {
    case "capability": return { label: PROMPTS.capability, placeholder: "e.g. Vendor KYB API" };
    case "specification": return { label: PROMPTS.specification, placeholder: "Describe the response, data and format you need…" };
    case "pricing": return { label: PROMPTS.pricing, placeholder: "" };
    case "commitment": return { label: PROMPTS.commitment, placeholder: "e.g. 20 USD₮0" };
    case "deadline": return { label: PROMPTS.deadline, placeholder: "e.g. 14 days" };
    case "review": return { label: "Demand review", placeholder: "" };
  }
}

function transactionError(message: string): string {
  if (message === "WALLET_NOT_CONNECTED" || message === "WALLET_NOT_FOUND") {
    return "Connect a wallet through Reown to continue. Your answers are saved.";
  }
  if (message === "WALLET_REJECTED") return "The wallet request was cancelled. Your answers are saved; you can try again.";
  if (message === "CHAIN_WRONG_NETWORK") return "Switch to X Layer in Reown, then try again.";
  if (message === "CHAIN_RECEIPT_FAILED") return "The transaction was not confirmed. No funded demand was created.";
  if (message === "DEMAND_INVALID_SPEC") return "The service specification is empty or exceeds 2,048 UTF-8 bytes.";
  if (message === "DEMAND_INVALID_AMOUNT") return "The contract rejected the amount. Check the price and minimum escrow, then review again.";
  if (message === "DEMAND_INVALID_CALLS") return "Expected calls must be a positive whole number within the contract limit.";
  if (message === "DEMAND_INVALID_DEADLINE") return "The deadline was rejected by X Layer. Choose a later deadline and retry.";
  return message;
}

export function CreateDemandChat({
  account,
  busy,
  contractConfigured,
  walletStatus,
  onConnect,
  onCreate,
  onRefreshBoard,
}: CreateDemandChatProps) {
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [step, setStep] = useState<ChatStep>("capability");
  const [pricingInput, setPricingInput] = useState({ maxPrice: "", expectedCalls: "" });
  const [pricingErrors, setPricingErrors] = useState({ maxPrice: "", expectedCalls: "" });
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [editingField, setEditingField] = useState<EditableDemandField | null>(null);
  const [editChoicesOpen, setEditChoicesOpen] = useState(false);
  const [outcome, setOutcome] = useState<CreateDemandRunOutcome | { kind: "message"; text: string } | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const submitLock = useRef(false);
  const createLock = useRef(false);
  const turns = buildTurns(answers, step, editingField);
  const reviewRows = buildReviewRows(answers);
  const prompt = editPrompt(editingField, step);
  const busyCreating = busy || createPending;
  const canCreate = step === "review" && !editingField && !editChoicesOpen && !busyCreating
    && contractConfigured && outcome?.kind !== "confirmed" && outcome?.kind !== "readback-failed";

  useEffect(() => {
    if (editingField) return;
    endRef.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [step, answers, editingField]);

  useEffect(() => {
    submitLock.current = false;
  }, [step, answers, editingField]);

  function handleAnswer(raw: string) {
    if (submitLock.current || (step === "review" && !editingField) || busyCreating || outcome?.kind === "confirmed") return;
    submitLock.current = true;
    setError("");
    try {
      if (editingField) {
        const edited = updateEditedAnswer(answers, editingField, raw);
        if (edited.kind === "invalid") throw new Error(edited.message);
        setAnswers(edited.answers);
        setEditingField(null);
        setValue("");
        setOutcome(null);
        setRefreshMessage("");
        return;
      }

      switch (step) {
        case "capability": {
          const result = parseCapabilityAnswer(raw);
          setAnswers((current) => ({ ...current, capability: result.capability, capabilityLabel: result.label }));
          setStep("specification");
          break;
        }
        case "specification":
          setAnswers((current) => ({ ...current, specification: parseSpecificationAnswer(raw) }));
          setStep("pricing");
          break;
        case "commitment":
          setAnswers((current) => ({ ...current, commitment: parseCommitmentAnswer(raw) }));
          setStep("deadline");
          break;
        case "deadline":
          setAnswers((current) => ({ ...current, deadlineDays: parseDeadlineAnswer(raw) }));
          setStep("review");
          setValue("");
          break;
      }
      if (step !== "deadline") setValue("");
      setOutcome(null);
      setRefreshMessage("");
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Check this answer and try again.");
      submitLock.current = false;
    }
  }

  function handlePricingContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || step !== "pricing" || busyCreating || outcome?.kind === "confirmed") return;
    submitLock.current = true;
    setError("");

    const nextErrors = { maxPrice: "", expectedCalls: "" };
    let maxPrice: string | null = null;
    let expectedCalls: string | null = null;
    try {
      maxPrice = parseMaximumPriceAnswer(pricingInput.maxPrice);
    } catch (priceError) {
      nextErrors.maxPrice = priceError instanceof Error ? priceError.message : "Enter a valid price per call.";
    }
    try {
      expectedCalls = parseExpectedCallsAnswer(pricingInput.expectedCalls);
    } catch (callsError) {
      nextErrors.expectedCalls = callsError instanceof Error ? callsError.message : "Enter a whole number of calls.";
    }

    setPricingErrors(nextErrors);
    if (nextErrors.maxPrice || nextErrors.expectedCalls || maxPrice === null || expectedCalls === null) {
      submitLock.current = false;
      return;
    }

    setAnswers((current) => ({ ...current, maxPrice, expectedCalls }));
    setStep("commitment");
    setValue("");
    setOutcome(null);
    setRefreshMessage("");
  }

  function chooseEdit(field: EditableDemandField) {
    setEditingField(field);
    setEditChoicesOpen(false);
    setValue(editValue(answers, field));
    setError("");
    setOutcome(null);
    setRefreshMessage("");
  }

  function cancelEdit() {
    setEditingField(null);
    setEditChoicesOpen(false);
    setValue("");
    setError("");
  }

  async function handleCreate() {
    if (!canCreate || createLock.current) return;
    const validationError = validateAnswers(answers);
    if (validationError) {
      setError(validationError);
      return;
    }
    createLock.current = true;
    setCreatePending(true);
    setOutcome(null);
    setError("");
    setRefreshMessage("");
    try {
      if (!account) {
        if (walletStatus === "unavailable") {
          setOutcome({ kind: "message", text: "Reown Unavailable. Configure Reown before creating a demand." });
          return;
        }
        if (walletStatus !== "ready") {
          setOutcome({ kind: "message", text: "Reown is still initializing. Your answers are saved; try again when it is ready." });
          return;
        }
        await onConnect();
        setOutcome({ kind: "message", text: "Continue in Reown to connect your wallet, then choose Create & Fund Demand again to proceed." });
        return;
      }
      const input: CreateDemandInput = {
        capability: answers.capability,
        specification: answers.specification,
        maxPrice: answers.maxPrice,
        expectedCalls: answers.expectedCalls,
        deadlineDays: answers.deadlineDays,
        commitment: answers.commitment,
      };
      setOutcome(await onCreate(input));
    } catch (createError) {
      setOutcome({ kind: "failed", message: createError instanceof Error ? createError.message : "The demand could not be created." });
    } finally {
      setCreatePending(false);
      createLock.current = false;
    }
  }

  async function handleRefresh() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const refreshedBoard = await onRefreshBoard();
      if (refreshedBoard === null) {
        setRefreshMessage("Could not refresh market data. Try again.");
        return;
      }
      if ((outcome?.kind === "confirmed" || outcome?.kind === "readback-failed") && outcome.verification) {
        const demandId = resolveUniqueCreatedDemandId(outcome.verification.before, refreshedBoard, outcome.verification.expected);
        if (demandId !== null) {
          setOutcome({ kind: "confirmed", hash: outcome.hash, demandId, verification: outcome.verification });
          setRefreshMessage("A unique matching request was verified from the refreshed market data.");
        } else {
          setRefreshMessage("Market data refreshed, but this request could not be uniquely verified. Do not submit it again yet.");
        }
        return;
      }
      setRefreshMessage("Market data refreshed. No transaction was submitted.");
    } catch {
      setRefreshMessage("Could not refresh market data. Try again.");
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }

  const completedReview = step === "review";
  const editing = editingField !== null;

  return (
    <section className="create-demand-chat" aria-labelledby="create-demand-title">
      <header className="create-demand-heading">
        <div className="create-demand-brand" role="img" aria-label="UNMET">
          <img src="/logos/unmet.png" alt="" width="32" height="32" />
        </div>
        <h1 id="create-demand-title">Create Demand</h1>
        <p>Describe what you need and fund your request.</p>
      </header>

      <div className="create-demand-thread" aria-label="Create Demand conversation">
        <div className="create-demand-turns" role="list" aria-live="polite" aria-relevant="additions text">
          {turns.map((turn, index) => (
            <div className="create-demand-turn" role="listitem" key={`${turn.speaker}-${index}`}>
              <span className="sr-only">{turn.speaker === "UNMET" ? "UNMET prompt" : "Your answer"}</span>
              <Bubble
                align={turn.speaker === "You" ? "end" : "start"}
                variant={turn.speaker === "You" ? "tinted" : "ghost"}
                className={turn.speaker === "You" ? "create-demand-user-bubble" : "create-demand-assistant-bubble"}
              >
                <BubbleContent className="create-demand-bubble-content">{turn.text}</BubbleContent>
              </Bubble>
            </div>
          ))}
          <div ref={endRef} aria-hidden="true" />
        </div>

        {completedReview && (
          <section className="create-demand-review" aria-labelledby="demand-review-title">
            <div className="create-demand-review-heading">
              <div>
                <p className="create-demand-kicker">READY FOR YOUR REVIEW</p>
                <h2 id="demand-review-title">Review your demand</h2>
              </div>
              {!editChoicesOpen && !editing && outcome?.kind !== "confirmed" && outcome?.kind !== "readback-failed" && (
                <Button type="button" variant="outline" className="create-demand-edit-trigger" onClick={() => setEditChoicesOpen(true)}>
                  <Pencil aria-hidden="true" />
                  Edit answers
                </Button>
              )}
            </div>

            <dl className="create-demand-review-grid">
              {reviewRows.map((row) => (
                <div className="create-demand-review-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                  {row.detail && <p>{row.detail}</p>}
                </div>
              ))}
            </dl>

            <p className="create-demand-contract-note">
              This creates a funded market request, not an API subscription or prepaid call balance.
            </p>

            {editChoicesOpen && (
              <div className="create-demand-edit-list" aria-label="Choose an answer to edit">
                {EDIT_FIELDS.map(({ field, label }) => (
                  <Button key={field} type="button" variant="outline" className="create-demand-edit-row" onClick={() => chooseEdit(field)}>
                    <span><strong>{label}</strong><small>{editPreview(answers, field)}</small></span>
                    <ArrowRight aria-hidden="true" />
                  </Button>
                ))}
                <Button type="button" variant="ghost" className="create-demand-cancel-edit" onClick={cancelEdit}>Back to review</Button>
              </div>
            )}

            {outcome?.kind === "confirmed" && (
              <div className="create-demand-outcome create-demand-outcome-success" role="status" aria-live="polite">
                <strong>Transaction confirmed on X Layer.</strong>
                <p>
                  {outcome.demandId !== null
                    ? "A unique matching request was verified in the refreshed market board."
                    : "The market board refreshed, but no unique new request ID could be confirmed."}
                </p>
                <a href={explorerTx(outcome.hash)} target="_blank" rel="noreferrer">View confirmed transaction</a>
                {outcome.demandId !== null && <Link to={demandHref(outcome.demandId)}>Open demand details</Link>}
                {outcome.demandId === null && (
                  <>
                    <Button type="button" variant="outline" disabled={refreshing} onClick={() => void handleRefresh()}>
                      <RefreshCw aria-hidden="true" />
                      {refreshing ? "Verifying..." : "Refresh / verify market"}
                    </Button>
                    <Link to="/market">Explore Market</Link>
                  </>
                )}
              </div>
            )}

            {outcome?.kind === "readback-failed" && (
              <div className="create-demand-outcome create-demand-outcome-error" role="alert" aria-live="polite">
                <strong>Transaction confirmed; chain readback unavailable.</strong>
                <p>{outcome.message ?? "The demand may be onchain, but its current state could not be read. Do not resubmit until you verify it."}</p>
                <a href={explorerTx(outcome.hash)} target="_blank" rel="noreferrer">View confirmed transaction</a>
                <Button type="button" variant="outline" disabled={refreshing} onClick={() => void handleRefresh()}>
                  <RefreshCw aria-hidden="true" />
                  {refreshing ? "Verifying..." : "Refresh / verify market"}
                </Button>
              </div>
            )}

            {outcome?.kind === "failed" && (
              <div className="create-demand-outcome create-demand-outcome-error" role="alert" aria-live="polite">
                <strong>Demand was not confirmed.</strong>
                <p>{transactionError(outcome.message)}</p>
              </div>
            )}

            {outcome?.kind === "message" && (
              <div className="create-demand-outcome" role="status" aria-live="polite">
                <p>{outcome.text}</p>
              </div>
            )}

            {refreshMessage && <p className="create-demand-refresh-message" role="status" aria-live="polite">{refreshMessage}</p>}

            {completedReview && !editChoicesOpen && !editing && outcome?.kind !== "confirmed" && outcome?.kind !== "readback-failed" && (
              <div className="create-demand-actions">
                {!account && walletStatus === "unavailable" && <p className="create-demand-wallet-state" role="status">Reown Unavailable</p>}
                {!account && walletStatus === "ready" && <p className="create-demand-wallet-state">Wallet connection opens in Reown only after you continue.</p>}
                {account && <p className="create-demand-wallet-state">Reown wallet connected · {account.slice(0, 6)}…{account.slice(-4)}</p>}
                <p className="create-demand-wallet-note">If required, Reown will request a separate USD₮0 approval before the demand transaction.</p>
                <Button type="button" className="create-demand-submit" disabled={!canCreate} onClick={() => void handleCreate()}>
                  {busyCreating ? (account ? "Waiting for wallet or X Layer…" : "Opening Reown…") : "Create & Fund Demand"}
                </Button>
              </div>
            )}
          </section>
        )}

        {!completedReview && step === "pricing" && !editing && (
          <form className="create-demand-pricing-form" onSubmit={handlePricingContinue} noValidate>
            <div className="create-demand-pricing-field">
              <label htmlFor="create-demand-max-price">Max price per call (USD₮0)</label>
              <Input
                id="create-demand-max-price"
                type="number"
                inputMode="decimal"
                min="0.000001"
                step="0.000001"
                required
                value={pricingInput.maxPrice}
                placeholder="0.02"
                aria-invalid={pricingErrors.maxPrice ? true : undefined}
                aria-describedby={pricingErrors.maxPrice ? "create-demand-max-price-error" : "create-demand-max-price-help"}
                className="create-demand-pricing-input"
                onChange={(event) => {
                  setPricingInput((current) => ({ ...current, maxPrice: event.target.value }));
                  if (pricingErrors.maxPrice) setPricingErrors((current) => ({ ...current, maxPrice: "" }));
                }}
              />
              {pricingErrors.maxPrice
                ? <p id="create-demand-max-price-error" className="create-demand-field-error" role="alert" aria-live="polite">{pricingErrors.maxPrice}</p>
                : <p id="create-demand-max-price-help" className="create-demand-field-help">Enter the most you would pay for one call.</p>}
            </div>
            <div className="create-demand-pricing-field">
              <label htmlFor="create-demand-expected-calls">Expected total calls</label>
              <Input
                id="create-demand-expected-calls"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                required
                value={pricingInput.expectedCalls}
                placeholder="1000"
                aria-invalid={pricingErrors.expectedCalls ? true : undefined}
                aria-describedby={pricingErrors.expectedCalls ? "create-demand-expected-calls-error" : "create-demand-expected-calls-help"}
                className="create-demand-pricing-input"
                onChange={(event) => {
                  setPricingInput((current) => ({ ...current, expectedCalls: event.target.value }));
                  if (pricingErrors.expectedCalls) setPricingErrors((current) => ({ ...current, expectedCalls: "" }));
                }}
              />
              {pricingErrors.expectedCalls
                ? <p id="create-demand-expected-calls-error" className="create-demand-field-error" role="alert" aria-live="polite">{pricingErrors.expectedCalls}</p>
                : <p id="create-demand-expected-calls-help" className="create-demand-field-help">Enter the total number of calls you expect to use.</p>}
            </div>
            <Button type="submit" className="create-demand-submit" disabled={busyCreating}>Continue</Button>
          </form>
        )}

        {(!completedReview || editing) && (step !== "pricing" || editing) && (
          <PromptInput
            value={value}
            onValueChange={setValue}
            onSubmit={handleAnswer}
            disabled={busyCreating}
            label={prompt.label}
            placeholder={prompt.placeholder}
            maxRows={6}
            submitLabel={editing ? "Save edited answer" : "Send answer"}
            error={error}
            className="create-demand-composer"
            actions={editing ? <Button type="button" variant="ghost" className="create-demand-cancel-edit" onClick={cancelEdit}>Cancel edit</Button> : null}
          />
        )}

        {!contractConfigured && completedReview && (
          <p className="create-demand-config-error" role="alert">The demand contract is not configured. Creation is unavailable.</p>
        )}
      </div>
    </section>
  );
}
