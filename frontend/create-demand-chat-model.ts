import { normalizeCapability } from "./capability";
import { formatUsd0, parseUsd0 } from "./contract";

export type CreateDemandAnswers = {
  capability: string;
  capabilityLabel: string;
  specification: string;
  maxPrice: string;
  expectedCalls: string;
  commitment: string;
  deadlineDays: string;
};

type PricingAnswer =
  | { kind: "complete"; maxPrice: string; expectedCalls: string }
  | { kind: "missing"; field: "maxPrice"; expectedCalls: string }
  | { kind: "missing"; field: "expectedCalls"; maxPrice: string };

export type EditableDemandField =
  | "capability"
  | "specification"
  | "maxPrice"
  | "expectedCalls"
  | "commitment"
  | "deadlineDays";

export type DemandReadbackMatch = {
  demandId: bigint;
  creator: string;
  capability: string;
  specification: string;
  maxUnitPrice: bigint;
  expectedCalls: bigint;
  committed: bigint;
};

type CreatedDemandMatch = {
  creator: string;
  capability: string;
  specification: string;
  maxPrice: bigint;
  expectedCalls: bigint;
  initialCommitment: bigint;
};

export type CreatedDemandVerification = {
  before: readonly Pick<DemandReadbackMatch, "demandId">[];
  expected: CreatedDemandMatch;
};

export function canContinueCreateDemandWorkflow(account: string | null, disconnecting: boolean): boolean {
  return account !== null && !disconnecting;
}

const UINT64_MAX = (1n << 64n) - 1n;
const UINT96_MAX = (1n << 96n) - 1n;
const NUMBER = "(?:[0-9]+(?:,[0-9]{3})*|[0-9]+)(?:\\.[0-9]+)?";
const INTEGER = "(?:[0-9]+(?:,[0-9]{3})*|[0-9]+)";

export function parseCapabilityAnswer(value: string): { capability: string; label: string } {
  const label = value.trim();
  if (!label) throw new Error("Enter the service or capability you need");
  try {
    return { capability: normalizeCapability(label), label };
  } catch {
    throw new Error("Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max)");
  }
}

export function parseSpecificationAnswer(value: string): string {
  const specification = value.trim();
  if (!specification) throw new Error("Enter a service specification");
  if (new TextEncoder().encode(specification).length > 2048) {
    throw new Error("Keep the specification within 2,048 UTF-8 bytes");
  }
  return specification;
}

export function parsePriceUsageAnswer(value: string): PricingAnswer {
  const text = value.trim();
  if (!text) throw new Error("Enter the maximum USD₮0 price for one call and the total number of calls you expect");

  const maxPrice = parsePricePerCall(text);
  const expectedCalls = parseExpectedCallsFromText(text);

  if (maxPrice === null && expectedCalls === null) {
    throw new Error("Enter both values: a maximum price per call in USD₮0 and the total number of calls you expect");
  }
  if (maxPrice === null) return { kind: "missing", field: "maxPrice", expectedCalls: expectedCalls! };
  if (expectedCalls === null) return { kind: "missing", field: "expectedCalls", maxPrice };
  return { kind: "complete", maxPrice, expectedCalls };
}

export function parseMaximumPriceAnswer(value: string): string {
  return formatAmount(parseAmount(value, "Maximum price"));
}

export function parseExpectedCallsAnswer(value: string): string {
  return parseExpectedCalls(value.trim().replace(/\s*(?:calls?|requests?)$/i, ""));
}

export function parseCommitmentAnswer(value: string): string {
  return formatAmount(parseAmount(value, "Initial escrow"));
}

export function deadlineDurationSeconds(value: string | number): number {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new Error("DEMAND_INVALID_DEADLINE");
  const seconds = Math.floor(days * 86400);
  if (seconds < 3600) throw new Error("DEMAND_DEADLINE_TOO_SHORT");
  return seconds;
}

export function parseDeadlineAnswer(value: string): string {
  const text = value.trim().replace(/\s*(?:days?|d)$/i, "").trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
    throw new Error("Enter a deadline in days, such as 14 days");
  }
  const days = Number(text);
  if (!Number.isFinite(days) || days <= 0) throw new Error("The deadline must be greater than zero days");
  if (days > 3650) throw new Error("The deadline must be 3,650 days or less");
  try {
    deadlineDurationSeconds(days);
  } catch (error) {
    if (error instanceof Error && error.message === "DEMAND_DEADLINE_TOO_SHORT") {
      throw new Error("The deadline must be at least one hour");
    }
    throw error;
  }
  return days.toString();
}

export function updateEditedAnswer(
  answers: CreateDemandAnswers,
  field: EditableDemandField,
  value: string,
): { kind: "valid"; answers: CreateDemandAnswers } | { kind: "invalid"; message: string } {
  try {
    const next = { ...answers };
    switch (field) {
      case "capability": {
        const parsed = parseCapabilityAnswer(value);
        next.capability = parsed.capability;
        next.capabilityLabel = parsed.label;
        break;
      }
      case "specification":
        next.specification = parseSpecificationAnswer(value);
        break;
      case "maxPrice":
        next.maxPrice = formatAmount(parseAmount(value, "Maximum price"));
        break;
      case "expectedCalls":
        next.expectedCalls = parseExpectedCallsAnswer(value);
        break;
      case "commitment":
        next.commitment = parseCommitmentAnswer(value);
        break;
      case "deadlineDays":
        next.deadlineDays = parseDeadlineAnswer(value);
        break;
    }
    const error = validateAnswers(next);
    if (error) return { kind: "invalid", message: error };
    return { kind: "valid", answers: next };
  } catch (error) {
    return { kind: "invalid", message: error instanceof Error ? error.message : "Check this answer and try again" };
  }
}

export function validateAnswers(answers: CreateDemandAnswers): string | null {
  try {
    parseCapabilityAnswer(answers.capabilityLabel || answers.capability);
    parseSpecificationAnswer(answers.specification);
    parseAmount(answers.maxPrice, "Maximum price");
    parseExpectedCalls(answers.expectedCalls);
    parseAmount(answers.commitment, "Initial escrow");
    parseDeadlineAnswer(answers.deadlineDays);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Check the demand terms and try again";
  }
}

export function buildReviewRows(answers: CreateDemandAnswers, now = Date.now()): Array<{ label: string; value: string; detail?: string }> {
  const deadlineSeconds = Math.floor(Number(answers.deadlineDays) * 86400);
  const estimate = new Date(now + deadlineSeconds * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  return [
    { label: "Service", value: answers.capabilityLabel || answers.capability, detail: `Canonical capability: ${answers.capability}` },
    { label: "Specification", value: answers.specification },
    { label: "Max price", value: `${answers.maxPrice} USD₮0 per call` },
    { label: "Expected usage", value: `${formatCount(BigInt(answers.expectedCalls))} calls` },
    { label: "Initial escrow", value: `${answers.commitment} USD₮0` },
    { label: "Deadline", value: `${answers.deadlineDays} days`, detail: `Estimated target: ${estimate}. This is an estimate until included onchain` },
  ];
}

export function formatPriceUsage(maxPrice: string, expectedCalls: string): string {
  return `${maxPrice} USD₮0 per call; ${formatCount(BigInt(expectedCalls))} calls total`;
}

export function resolveUniqueCreatedDemandId(
  before: readonly Pick<DemandReadbackMatch, "demandId">[],
  after: readonly DemandReadbackMatch[],
  expected: CreatedDemandMatch,
): bigint | null {
  const beforeIds = new Set(before.map((demand) => demand.demandId.toString()));
  const matches = after.filter((demand) =>
    !beforeIds.has(demand.demandId.toString())
    && demand.creator.toLowerCase() === expected.creator.toLowerCase()
    && demand.capability === expected.capability
    && demand.specification === expected.specification
    && demand.maxUnitPrice === expected.maxPrice
    && demand.expectedCalls === expected.expectedCalls
    && demand.committed >= expected.initialCommitment,
  );
  return matches.length === 1 ? matches[0]!.demandId : null;
}

function parsePricePerCall(text: string): string | null {
  const labeled = [...text.matchAll(/(?:max(?:imum)?\s+)?(?:unit\s+)?price(?:\s+per\s+call)?\s*[:=]\s*(?:\$|USD₮0\s*|USDT0\s*|USD\s*)?((?:[0-9]+(?:,[0-9]{3})*|[0-9]+)(?:\.[0-9]+)?)/gi)];
  const pattern = new RegExp(`(?:\\$|USD₮0\\s*|USDT0\\s*|USD\\s*)?(${NUMBER})\\s*(?:USD₮0\\s*|USDT0\\s*|USD\\s*)?(?:per\\s*(${INTEGER})?\\s*(?:calls?|requests?)|/\\s*(${INTEGER})?\\s*(?:calls?|requests?))`, "gi");
  const unitPrices = labeled.map((match) => ({ amount: match[1]!, divisor: "1" }));
  if (unitPrices.length === 0) {
    for (const match of text.matchAll(pattern)) {
      unitPrices.push({ amount: match[1]!, divisor: match[2] ?? match[3] ?? "1" });
    }
  }
  if (unitPrices.length === 0) return null;

  const unique = new Map(unitPrices.map((price) => [`${price.amount}/${price.divisor}`, price]));
  if (unique.size !== 1) throw new Error("The maximum price is ambiguous. State one exact price per call");
  const { amount, divisor } = [...unique.values()][0]!;
  const total = parseAmount(amount, "Maximum price");
  const calls = parseInteger(divisor, "Price divisor");
  const unit = total / calls;
  if (unit <= 0n || total % calls !== 0n) {
    throw new Error("Use an exact USD₮0 unit price that can be represented with 6 decimal places");
  }
  if (unit > UINT96_MAX) throw new Error("The maximum price is above the contract limit");
  return formatAmount(unit);
}

function parseExpectedCallsFromText(text: string): string | null {
  const expressions = [
    new RegExp(`(${INTEGER})\\s+expected\\s+(?:calls?|requests?)`, "gi"),
    new RegExp(`(?:expected\\s+(?:calls?|usage)|calls?\\s+expected)\\s*[:=]\\s*(${INTEGER})`, "gi"),
    new RegExp(`(?:expect(?:ed)?|usage|plan(?:ned)?)(?:\\s+to)?\\s+(?:use\\s+)?(${INTEGER})\\s+(?:calls?|requests?)`, "gi"),
  ];
  const values = new Set<string>();
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) values.add(parseExpectedCalls(match[1]!));
  }
  if (values.size > 1) throw new Error("Expected usage is ambiguous. Provide one expected call count");
  return values.values().next().value ?? null;
}

function parseExpectedCalls(value: string): string {
  const text = value.trim();
  if (!new RegExp(`^${INTEGER}$`).test(text)) {
    throw new Error("Enter a positive whole number of expected calls");
  }
  const calls = BigInt(text.replaceAll(",", ""));
  if (calls <= 0n || calls > UINT64_MAX) throw new Error("Enter a positive whole number of expected calls within the contract limit");
  return calls.toString();
}

function parseAmount(value: string, field: string): bigint {
  const text = value.trim()
    .replace(/^(?:\$|USD₮0|USDT0|USD)\s*/i, "")
    .replace(/\s*(?:USD₮0|USDT0|USD)$/i, "");
  const invalid = "Enter a valid " + field.toLowerCase() + " amount with up to 6 decimal places";
  if (!text) throw new Error("Enter a " + field.toLowerCase() + " greater than zero");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error(invalid);
  const fraction = text.split(".")[1];
  if (fraction && fraction.length > 6) throw new Error(field + " supports up to 6 decimal places");
  let amount: bigint;
  try {
    amount = parseUsd0(text.replaceAll(",", ""));
  } catch {
    throw new Error(invalid);
  }
  if (amount <= 0n) throw new Error(field + " must be greater than zero");
  if (amount > UINT96_MAX) throw new Error(field + " is above the contract limit");
  return amount;
}
function formatAmount(amount: bigint): string {
  return formatUsd0(amount);
}

function parseInteger(value: string, label: string): bigint {
  const text = value.trim().replaceAll(",", "");
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a positive whole number`);
  const integer = BigInt(text);
  if (integer <= 0n) throw new Error(`${label} must be a positive whole number`);
  return integer;
}

function formatCount(value: bigint): string {
  return new Intl.NumberFormat("en-US").format(value);
}
