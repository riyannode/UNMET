import { startTransition, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import type { Address, Hash, Hex } from "viem";
import { CreateDemandChat, type CreateDemandRunOutcome } from "../CreateDemandChat";

const walletA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const walletB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let resolveSuspense: (() => void) | undefined;
const suspenseGate = new Promise<void>((resolve) => { resolveSuspense = resolve; });
const intent = {
  to: "0x1111111111111111111111111111111111111111" as Address,
  data: "0x1234" as Hex,
  value: 0n,
};

function SuspendsAfterWalletRender({ suspend }: { suspend: boolean }) {
  if (suspend) {
    document.documentElement.dataset.walletBRenders = String(Number(document.documentElement.dataset.walletBRenders ?? "0") + 1);
    throw suspenseGate;
  }
  return null;
}

function Harness() {
  const [account, setAccount] = useState<string | null>(walletA);
  const [suspend, setSuspend] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState(false);
  const createCalls = useRef(0);
  const createResolvers = useRef<Array<(outcome: CreateDemandRunOutcome) => void>>([]);
  const verifyResolvers = useRef<Array<(outcome: CreateDemandRunOutcome) => void>>([]);
  const refreshResolvers = useRef<Array<(board: readonly never[] | null) => void>>([]);

  useEffect(() => { void runRegression(); }, []);

  async function runRegression() {
    let checkpoint = "starting";
    try {
      await waitFor(() => document.querySelector("textarea"));
      await answer("Vendor KYB API", () => document.body.innerText.includes("What should the service provide?"));
      await answer("Verify business registration and return a structured result", () => Boolean(document.querySelector("#create-demand-max-price")));
      setInput("#create-demand-max-price", "0.02");
      setInput("#create-demand-expected-calls", "1000");
      document.querySelector(".create-demand-pricing-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await waitFor(() => document.body.innerText.includes("How much would you like to commit to escrow now?"));
      await answer("20", () => document.body.innerText.includes("What's the deadline?"));
      await answer("14 days", () => Boolean(findButton("Create & Fund Demand")));

      checkpoint = "suspending wallet B while wallet A refresh is pending";
      findButton("Create & Fund Demand")?.click();
      await waitFor(() => Boolean(findButton("Refresh / verify market")));
      findButton("Refresh / verify market")?.click();
      await waitFor(() => refreshResolvers.current.length === 1);
      await waitFor(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Verifying")));
      startTransition(() => {
        setAccount(walletB);
        setSuspend(true);
      });
      await waitFor(() => Number(document.documentElement.dataset.walletBRenders ?? "0") > 0);
      refreshResolvers.current[0]?.([]);
      const refreshedOnA = await waitFor(() => document.body.innerText.includes("Market data refreshed. No transaction was submitted"), 500);
      const refreshButtonEnabled = findButton("Refresh / verify market")?.disabled === false;
      resolveSuspense?.();
      setSuspend(false);
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletB);

      checkpoint = "testing create across A -> disconnected -> B";
      flushSync(() => setAccount(walletA));
      checkpoint = "waiting for wallet A before creating";
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletA);
      findButton("Create & Fund Demand")?.click();
      checkpoint = "waiting for wallet A create to start";
      await waitFor(() => createResolvers.current.length === 1);
      flushSync(() => setAccount(null));
      checkpoint = "waiting for disconnected create state";
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === "disconnected");
      flushSync(() => setAccount(walletB));
      checkpoint = "waiting for wallet B after create disconnect";
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletB);
      findButton("Create & Fund Demand")?.click();
      checkpoint = "waiting for wallet B create to start";
      await waitFor(() => createResolvers.current.length === 2);
      createResolvers.current[0]?.({ kind: "failed", message: "stale wallet A create result" });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const createStillPending = findButton("Waiting for wallet or X Layer…")?.disabled === true
        && !document.body.innerText.includes("stale wallet A create result");
      createResolvers.current[1]?.(confirmedOutcome());
      await waitFor(() => document.body.innerText.includes("Transaction confirmed on X Layer"));

      checkpoint = "testing verify across A -> disconnected -> B";
      flushSync(() => { setPendingEnabled(true); setAccount(walletA); });
      checkpoint = "waiting for wallet A pending transaction";
      await waitFor(() => Boolean(findButton("Verify existing transaction")));
      findButton("Verify existing transaction")?.click();
      checkpoint = "waiting for wallet A verification";
      await waitFor(() => verifyResolvers.current.length === 1);
      flushSync(() => setAccount(null));
      checkpoint = "waiting for disconnected verify state";
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === "disconnected");
      flushSync(() => setAccount(walletB));
      checkpoint = "waiting for wallet B pending transaction";
      await waitFor(() => Boolean(findButton("Verify existing transaction")));
      findButton("Verify existing transaction")?.click();
      checkpoint = "waiting for wallet B verification";
      await waitFor(() => verifyResolvers.current.length === 2);
      verifyResolvers.current[0]?.({ kind: "failed", message: "stale wallet A verify result" });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const verifyStillPending = findButton("Checking transaction...")?.disabled === true
        && !document.body.innerText.includes("stale wallet A verify result");
      verifyResolvers.current[1]?.({ kind: "failed", message: "wallet B verify result" });
      await waitFor(() => document.body.innerText.includes("wallet B verify result"));

      checkpoint = "testing refresh across A -> disconnected -> B";
      flushSync(() => { setPendingEnabled(false); setAccount(walletA); });
      await waitFor(() => Boolean(findButton("Create & Fund Demand")));
      findButton("Create & Fund Demand")?.click();
      await waitFor(() => createCalls.current === 4 && Boolean(findButton("Refresh / verify market")));
      findButton("Refresh / verify market")?.click();
      await waitFor(() => refreshResolvers.current.length === 2);
      flushSync(() => setAccount(null));
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === "disconnected");
      flushSync(() => setAccount(walletB));
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletB);
      refreshResolvers.current[1]?.([]);
      await new Promise((resolve) => window.setTimeout(resolve, 50));

      checkpoint = "testing A -> disconnected -> A create session renewal";
      flushSync(() => setAccount(walletA));
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletA);
      findButton("Create & Fund Demand")?.click();
      await waitFor(() => createResolvers.current.length === 3);
      flushSync(() => setAccount(null));
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === "disconnected");
      flushSync(() => setAccount(walletA));
      await waitFor(() => document.querySelector("[data-testid='committed-wallet']")?.getAttribute("data-wallet") === walletA);
      findButton("Create & Fund Demand")?.click();
      await waitFor(() => createResolvers.current.length === 4);
      createResolvers.current[2]?.({ kind: "failed", message: "stale disconnected wallet A create result" });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const reconnectedCreateStillPending = findButton("Waiting for wallet or X Layer…")?.disabled === true
        && !document.body.innerText.includes("stale disconnected wallet A create result");
      createResolvers.current[3]?.(confirmedOutcome());
      await waitFor(() => document.body.innerText.includes("Transaction confirmed on X Layer"));

      const draftPreserved = document.body.innerText.includes("Vendor KYB API")
        && document.body.innerText.includes("Verify business registration and return a structured result")
        && document.body.innerText.includes("Max price")
        && document.body.innerText.includes("1,000 calls");
      const refreshIsolated = !document.body.innerText.includes("Market data refreshed. No transaction was submitted");
      const passed = refreshedOnA && refreshButtonEnabled && createStillPending && verifyStillPending
        && reconnectedCreateStillPending && draftPreserved && refreshIsolated;
      setResult(passed
        ? "PASS: real CreateDemandChat covered suspended rendering, create/verify/refresh session isolation, A→disconnected→A renewal, and draft preservation"
        : `FAIL: suspended refresh=${refreshedOnA}, refresh unlocked=${refreshButtonEnabled}, create isolated=${createStillPending}, verify isolated=${verifyStillPending}, reconnect isolation=${reconnectedCreateStillPending}, draft preserved=${draftPreserved}, refresh isolated=${refreshIsolated}`);
    } catch (error) {
      refreshResolvers.current.forEach((resolve) => resolve([]));
      createResolvers.current.forEach((resolve) => resolve({ kind: "failed", message: "test cleanup" }));
      verifyResolvers.current.forEach((resolve) => resolve({ kind: "failed", message: "test cleanup" }));
      resolveSuspense?.();
      setSuspend(false);
      setResult(`FAIL at ${checkpoint}: ${error instanceof Error ? error.message : String(error)}; B render attempts=${document.documentElement.dataset.walletBRenders ?? "0"}`);
    }
  }

  const pendingTransaction = pendingEnabled && account ? {
    kind: "unknown" as const,
    stage: "demand" as const,
    hash: `0x${"2".repeat(64)}` as Hash,
    intent,
    message: "Transaction status unknown",
  } : null;

  return (
    <MemoryRouter>
      <Suspense fallback={<div>Wallet B render suspended</div>}>
        <section data-testid="committed-wallet" data-wallet={account ?? "disconnected"}>{account}
          <CreateDemandChat
            account={account as Address | null}
            busy={false}
            disconnecting={false}
            contractConfigured
            walletStatus="ready"
            pendingTransaction={pendingTransaction}
            onConnect={async () => {}}
            onCreate={async (): Promise<CreateDemandRunOutcome> => {
              const call = createCalls.current++;
              if (call === 0 || call === 3) return confirmedOutcome();
              return new Promise((resolve) => createResolvers.current.push(resolve));
            }}
            onVerify={async () => new Promise((resolve) => verifyResolvers.current.push(resolve))}
            onRefreshBoard={() => new Promise((resolve) => refreshResolvers.current.push(resolve))}
          />
          <SuspendsAfterWalletRender suspend={suspend} />
        </section>
      </Suspense>
    </MemoryRouter>
  );
}

function confirmedOutcome(): CreateDemandRunOutcome {
  return { kind: "confirmed", hash: `0x${"1".repeat(64)}` as Hash, demandId: null };
}

function setResult(message: string) {
  const result = document.querySelector("#result");
  if (result) result.textContent = message;
}

function findButton(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === label) ?? null;
}

function setInput(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Missing ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function answer(value: string, next: () => boolean) {
  const field = await waitFor(() => document.querySelector<HTMLTextAreaElement>("textarea"));
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.form?.requestSubmit();
  await waitFor(next);
}

async function waitFor<T>(read: () => T | null | false | undefined, timeoutMs = 3000): Promise<T> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the regression scenario");
}

createRoot(document.querySelector("#root")!).render(<Harness />);
