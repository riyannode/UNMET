import { animate, stagger } from "animejs";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router";
import { getAddress, isAddress, type Address, type Hash, type Hex } from "viem";
import type { AppKit } from "@reown/appkit/react";
import {
  CHAIN_ID,
  DEMAND_CONTRACT,
  approveService,
  createDemand,
  effectiveStatus,
  explorerTx,
  finalizeDemand,
  formatUsd0,
  parseUsd0,
  readBoard,
  readDemandOnChain,
  readSupport,
  refundDemand,
  rejectService,
  reopenDemand,
  statusName,
  submitService,
  supportDemand,
  verifyTransaction,
  setReownWalletProvider,
  type DemandView,
  type SupportView,
} from "./contract.ts";
import {
  afterConfirmedTransaction,
  readSupportForIdentity,
  settleBoardRead,
  settleSupportRead,
  type SupportReadResult,
} from "./app-state.ts";
import { ReuiAppShell } from "./components/examples/c-sidebar-1.tsx";
import { CreateDemandChat, type CreateDemandRunOutcome, type CreateDemandTransactionOutcome } from "./CreateDemandChat";
import { normalizeCapability } from "./capability";
import { resolveUniqueCreatedDemandId } from "./create-demand-chat-model";
import type { CreatedDemandVerification, DemandReadbackMatch } from "./create-demand-chat-model";
import { isTransactionSubmissionBlocked, TransactionLifecycleError, type TransactionState, type TransactionUpdateHandler } from "./transaction-lifecycle";
import { demandHref, parseDemandId, ROUTES } from "./routing.ts";
import { errorMessage } from "./errors.ts";
import { resolveReownStatus, type ReownStatus } from "./reown-status.ts";
type CreateDemandInput = Parameters<typeof createDemand>[0];

const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();
const EMPTY_SUPPORT: SupportView = { commitment: 0n, expectedCalls: 0n, approved: false, rejected: false, refundable: false };
const PENDING_CREATE_KEY = "unmet.pending-create-transaction";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPendingCreate(): CreateDemandTransactionOutcome | null {
  if (typeof window === "undefined") return null;
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(PENDING_CREATE_KEY) ?? "null");
    if (!isRecord(stored) || stored.kind !== "unknown" || (stored.stage !== "approval" && stored.stage !== "demand")) return null;
    if (typeof stored.hash !== "string" || !/^0x[\da-f]{64}$/i.test(stored.hash)) return null;
    if (!isRecord(stored.intent)) return null;
    const { to, data, value } = stored.intent;
    if (typeof to !== "string" || !isAddress(to) || typeof data !== "string" || !/^0x(?:[\da-f]{2})*$/i.test(data)) return null;
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    return {
      kind: "unknown",
      stage: stored.stage,
      hash: stored.hash as Hash,
      intent: { to: getAddress(to), data: data as Hex, value: BigInt(value) },
      message: "The transaction receipt has not been verified yet.",
    };
  } catch {
    return null;
  }
}

function storePendingCreate(outcome: CreateDemandTransactionOutcome | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!outcome || outcome.kind !== "unknown") {
      window.sessionStorage.removeItem(PENDING_CREATE_KEY);
      return;
    }
    window.sessionStorage.setItem(PENDING_CREATE_KEY, JSON.stringify({
      kind: outcome.kind,
      stage: outcome.stage,
      hash: outcome.hash,
      intent: { ...outcome.intent, value: outcome.intent.value.toString() },
    }));
  } catch {
    // The in-memory guard remains active when session storage is unavailable.
  }
}

type AppOutletContext = {
  board: DemandView[];
  boardLoading: boolean;
  boardLoadError: boolean;
  selectedId: bigint | null;
  account: Address | null;
  activity: DemandView[];
  activityState: "loading" | "ready" | "error";
  support: SupportView;
  supportState: "loading" | "ready" | "error";
  busy: boolean;
  lastTx: Hash | null;
  pendingCreate: CreateDemandTransactionOutcome | null;
  run: (label: string, fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>, createdDemand?: CreateDemandInput) => Promise<CreateDemandRunOutcome>;
  verifyCreate: (outcome: CreateDemandTransactionOutcome) => Promise<CreateDemandRunOutcome>;
  connect: () => Promise<void>;
  refreshBoard: () => Promise<readonly DemandReadbackMatch[] | null>;
  walletStatus: ReownStatus;
};

export default function App() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const demandMatch = useMatch(ROUTES.demandDetail.href);
  const selectedId = parseDemandId(demandMatch?.params.demandId);
  const [board, setBoard] = useState<DemandView[]>([]);
  const boardRef = useRef(board);
  boardRef.current = board;
  const [boardLoading, setBoardLoading] = useState(true);
  const [walletKit, setWalletKit] = useState<AppKit | null>(null);
  const [walletModuleLoaded, setWalletModuleLoaded] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [support, setSupport] = useState<SupportView>(EMPTY_SUPPORT);
  const [supportKey, setSupportKey] = useState("");
  const [supportState, setSupportState] = useState<"loading" | "ready" | "error">("ready");
  const [mySupportIds, setMySupportIds] = useState<Set<string>>(new Set());
  const [activityState, setActivityState] = useState<"loading" | "ready" | "error">("ready");
  const [busy, setBusy] = useState(false);
  const [readStatus, setReadStatus] = useState({ actionStatus: "", boardError: "", supportError: "" });
  const { actionStatus: status, boardError, supportError } = readStatus;
  const boardLoadError = boardError !== "";
  const [lastTx, setLastTx] = useState<Hash | null>(null);
  const [transactionState, setTransactionState] = useState<TransactionState | null>(null);
  const [pendingCreate, setPendingCreate] = useState<CreateDemandTransactionOutcome | null>(readPendingCreate);
  const createTransactionStateRef = useRef<TransactionState | null>(pendingCreate?.kind === "unknown" ? "unknown" : null);
  const walletStatus = resolveReownStatus(Boolean(reownProjectId), walletModuleLoaded, Boolean(walletKit));
  const setStatus = useCallback((actionStatus: string) => {
    setReadStatus((current) => ({ ...current, actionStatus }));
  }, []);

  const supportIdentity = account && selectedId !== null ? account.toLowerCase() + ":" + selectedId.toString() : "";
  const supportIdentityRef = useRef(supportIdentity);
  supportIdentityRef.current = supportIdentity;
  const supportRequestRef = useRef(0);
  const activityRoute = location.pathname === ROUTES.myActivity.href;
  const currentSupport = supportIdentity !== "" && supportKey === supportIdentity ? support : EMPTY_SUPPORT;
  const currentSupportState = supportIdentity === "" ? "ready" : supportKey === supportIdentity ? supportState : "loading";

  useEffect(() => { storePendingCreate(pendingCreate); }, [pendingCreate]);

  const loadSupport = useCallback(async (
    demandId: bigint,
    supporter: Address,
    identity: string,
    isLive: () => boolean = () => true,
  ): Promise<SupportReadResult<SupportView>> => {
    if (!isLive() || supportIdentityRef.current !== identity) return { kind: "stale" };
    const request = ++supportRequestRef.current;
    setSupportKey(identity);
    setSupportState("loading");
    setReadStatus((current) => settleSupportRead(current, { kind: "loading" }));
    const result = await readSupportForIdentity(
      identity,
      () => readSupport(demandId, supporter),
      (candidate) => isLive() && supportIdentityRef.current === candidate && supportRequestRef.current === request,
    );
    if (result.kind === "ready") {
      setSupport(result.value);
      setSupportState("ready");
      setReadStatus((current) => settleSupportRead(current, { kind: "success" }));
    } else if (result.kind === "error") {
      setSupport(EMPTY_SUPPORT);
      setSupportState("error");
      setReadStatus((current) => settleSupportRead(current, { kind: "error", message: errorMessage(result.error) }));
    }
    return result;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    setBoardLoading(true);
    try {
      const latestBoard = await readBoard();
      boardRef.current = latestBoard;
      setBoard(latestBoard);
      setReadStatus((current) => settleBoardRead(current, { kind: "success" }));
      return true;
    } catch (error) {
      setReadStatus((current) => settleBoardRead(current, { kind: "error", message: errorMessage(error) }));
      return false;
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const refreshBoardForCreate = useCallback(async (): Promise<readonly DemandReadbackMatch[] | null> => {
    return await refresh() ? boardRef.current : null;
  }, [refresh]);

  const syncWallet = useCallback((kit: AppKit | null = walletKit) => {
    if (kit) {
      const wallet = kit.getAccount("eip155");
      const address = wallet?.address;
      setAccount(wallet?.isConnected && address && isAddress(address) ? getAddress(address) : null);
      const chain = kit.getChainId();
      setChainOk(chain === undefined || Number(chain) === CHAIN_ID);
      setReownWalletProvider(kit.getWalletProvider());
      return;
    }
    setReownWalletProvider(null);
    setAccount(null);
    setChainOk(true);
  }, [walletKit]);

  useEffect(() => {
    if (!reownProjectId) return;
    let live = true;
    void import("./reown.ts")
      .then(({ appKit: kit }) => {
        if (live) {
          setWalletKit(kit);
          setWalletModuleLoaded(true);
        }
      })
      .catch(() => {
        if (live) {
          setWalletKit(null);
          setWalletModuleLoaded(true);
        }
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    void refresh();
    void syncWallet();
    const kit = walletKit;
    if (kit) {
      const stopAccount = kit.subscribeAccount(() => void syncWallet(), "eip155");
      const stopNetwork = kit.subscribeNetwork(() => void syncWallet());
      const stopProvider = kit.subscribeProviders(() => setReownWalletProvider(kit.getWalletProvider()));
      return () => {
        stopAccount();
        stopNetwork();
        stopProvider();
        setReownWalletProvider(null);
      };
    }
    setReownWalletProvider(null);
  }, [refresh, syncWallet, walletKit]);

  useEffect(() => {
    if (!account || selectedId === null) {
      supportRequestRef.current += 1;
      setSupport(EMPTY_SUPPORT);
      setSupportKey("");
      setSupportState("ready");
      setReadStatus((current) => settleSupportRead(current, { kind: "success" }));
      return;
    }
    let live = true;
    const key = account.toLowerCase() + ":" + selectedId.toString();
    setSupport(EMPTY_SUPPORT);
    void loadSupport(selectedId, account, key, () => live);
    return () => { live = false; };
  }, [account, loadSupport, selectedId]);

  useEffect(() => {
    if (!account || !activityRoute) {
      setMySupportIds(new Set());
      setActivityState("ready");
      return;
    }
    if (boardLoading) {
      setActivityState("loading");
      return;
    }
    if (boardLoadError) {
      setMySupportIds(new Set());
      setActivityState("error");
      return;
    }
    if (board.length === 0) {
      setMySupportIds(new Set());
      setActivityState("ready");
      return;
    }
    let live = true;
    setMySupportIds(new Set());
    setActivityState("loading");
    void Promise.all(board.map(async (demand) => {
      const own = await readSupport(demand.demandId, account);
      return own.commitment > 0n ? demand.demandId.toString() : null;
    })).then((ids) => {
      if (live) {
        setMySupportIds(new Set(ids.filter((id): id is string => id !== null)));
        setActivityState("ready");
      }
    }).catch((error: unknown) => {
      if (live) {
        setActivityState("error");
        setStatus(errorMessage(error));
      }
    });
    return () => { live = false; };
  }, [account, activityRoute, board, boardLoading, boardLoadError, setStatus]);

  async function connect() {
    const kit = walletKit;
    if (!kit) return;
    setBusy(true);
    setStatus("");
    try {
      await kit.open({ view: kit.getAccount("eip155")?.isConnected ? "Account" : "Connect", namespace: "eip155" });
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function run(
    label: string,
    fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>,
    createdDemand?: CreateDemandInput,
  ): Promise<CreateDemandRunOutcome> {
    if (label === "create" && (pendingCreate?.kind === "unknown" || isTransactionSubmissionBlocked(createTransactionStateRef.current))) {
      return pendingCreate?.kind === "unknown"
        ? pendingCreate
        : { kind: "failed", message: "A demand transaction is already pending. Verify it before creating another." };
    }
    setBusy(true);
    setStatus(label + " pending");
    setLastTx(null);
    setTransactionState(null);
    const supportSnapshot = account && selectedId !== null
      ? { demandId: selectedId, supporter: account, identity: supportIdentity }
      : null;
    const boardBeforeTransaction = boardRef.current;
    let confirmedHash: Hash | null = null;
    let verification: CreatedDemandVerification | undefined;
    const onUpdate: TransactionUpdateHandler = ({ stage, state, hash, intent }) => {
      setLastTx(hash);
      setTransactionState(state);
      setStatus(`${label} ${stage === "action" ? "transaction" : stage} ${state === "broadcast" ? "pending" : state}`);
      if (label === "create") {
        createTransactionStateRef.current = state;
        storePendingCreate(state === "broadcast" || state === "unknown"
          ? { kind: "unknown", stage: stage === "action" ? "demand" : stage, hash, intent, message: "The transaction receipt has not been verified yet." }
          : null);
      }
    };
    try {
      verification = createdDemand && account
        ? {
          before: boardBeforeTransaction.map(({ demandId }) => ({ demandId })),
          expected: {
            creator: account,
            capability: normalizeCapability(createdDemand.capability),
            specification: createdDemand.specification.trim(),
            maxPrice: parseUsd0(createdDemand.maxPrice),
            expectedCalls: BigInt(createdDemand.expectedCalls),
            initialCommitment: parseUsd0(createdDemand.commitment),
          },
        }
        : undefined;
      const readback = await afterConfirmedTransaction(
        () => fn(onUpdate),
        (hash) => {
          confirmedHash = hash;
          setLastTx(hash);
          setTransactionState("confirmed");
          if (label === "create") createTransactionStateRef.current = "confirmed";
        },
        refresh,
        async () => supportSnapshot
          ? loadSupport(supportSnapshot.demandId, supportSnapshot.supporter, supportSnapshot.identity)
          : null,
      );
      await syncWallet();
      if (!readback.boardReadbackSucceeded) {
        setStatus("CHAIN_STATE_READBACK_FAILED");
        return confirmedHash
          ? { kind: "readback-failed", hash: confirmedHash, ...(verification ? { verification } : {}) }
          : { kind: "failed", message: "The transaction result could not be verified." };
      }

      const demandId = verification
        ? resolveUniqueCreatedDemandId(verification.before, boardRef.current, verification.expected)
        : null;
      setStatus(label + " success");
      return confirmedHash
        ? { kind: "confirmed", hash: confirmedHash, demandId, ...(verification ? { verification } : {}) }
        : { kind: "failed", message: "The transaction hash was not available." };
    } catch (error) {
      if (error instanceof TransactionLifecycleError) {
        setLastTx(error.hash);
        setTransactionState(error.state);
        setStatus(`${label} ${error.stage} ${error.state}`);
        if (error.stage === "action") return { kind: "failed", message: error.message };
        const outcome: CreateDemandTransactionOutcome = {
          kind: error.state,
          stage: error.stage,
          hash: error.hash,
          intent: error.intent,
          message: error.message,
          ...(verification ? { verification } : {}),
        };
        if (label === "create") setPendingCreate(error.state === "unknown" ? outcome : null);
        return outcome;
      }
      const message = errorMessage(error);
      setStatus(message);
      return confirmedHash
        ? { kind: "readback-failed", hash: confirmedHash, message }
        : { kind: "failed", message };
    } finally {
      setBusy(false);
    }
  }

  async function verifyCreate(outcome: CreateDemandTransactionOutcome): Promise<CreateDemandRunOutcome> {
    setBusy(true);
    setStatus(`create ${outcome.stage} pending`);
    setLastTx(outcome.hash);
    setTransactionState("broadcast");
    const supportSnapshot = account && selectedId !== null
      ? { demandId: selectedId, supporter: account, identity: supportIdentity }
      : null;
    let confirmedHash: Hash | null = null;
    const onUpdate: TransactionUpdateHandler = ({ stage, state, hash, intent }) => {
      setLastTx(hash);
      setTransactionState(state);
      setStatus(`create ${stage} ${state === "broadcast" ? "pending" : state}`);
      createTransactionStateRef.current = state;
      storePendingCreate(state === "broadcast" || state === "unknown"
        ? { kind: "unknown", stage: stage === "action" ? "demand" : stage, hash, intent, message: "The transaction receipt has not been verified yet." }
        : null);
    };

    try {
      if (outcome.stage === "approval") {
        const hash = await verifyTransaction("approval", outcome.hash, outcome.intent, onUpdate);
        setPendingCreate(null);
        setStatus("create approval confirmed");
        return { kind: "approval-confirmed", hash };
      }

      const readback = await afterConfirmedTransaction(
        () => verifyTransaction("demand", outcome.hash, outcome.intent, onUpdate),
        (hash) => {
          confirmedHash = hash;
          setLastTx(hash);
          setTransactionState("confirmed");
          createTransactionStateRef.current = "confirmed";
          setPendingCreate(null);
        },
        refresh,
        async () => supportSnapshot
          ? loadSupport(supportSnapshot.demandId, supportSnapshot.supporter, supportSnapshot.identity)
          : null,
      );
      await syncWallet();
      if (!readback.boardReadbackSucceeded) {
        setStatus("CHAIN_STATE_READBACK_FAILED");
        return confirmedHash
          ? { kind: "readback-failed", hash: confirmedHash, ...(outcome.verification ? { verification: outcome.verification } : {}) }
          : { kind: "failed", message: "The transaction result could not be verified." };
      }
      const demandId = outcome.verification
        ? resolveUniqueCreatedDemandId(outcome.verification.before, boardRef.current, outcome.verification.expected)
        : null;
      setStatus("create success");
      return confirmedHash
        ? { kind: "confirmed", hash: confirmedHash, demandId, ...(outcome.verification ? { verification: outcome.verification } : {}) }
        : { kind: "failed", message: "The transaction hash was not available." };
    } catch (error) {
      if (error instanceof TransactionLifecycleError) {
        setLastTx(error.hash);
        setTransactionState(error.state);
        setStatus(`create ${error.stage} ${error.state}`);
        if (error.stage === "action") return { kind: "failed", message: error.message };
        const nextOutcome: CreateDemandTransactionOutcome = {
          kind: error.state,
          stage: error.stage,
          hash: error.hash,
          intent: error.intent,
          message: error.message,
          ...(outcome.verification ? { verification: outcome.verification } : {}),
        };
        setPendingCreate(error.state === "unknown" ? nextOutcome : null);
        return nextOutcome;
      }
      const message = errorMessage(error);
      setStatus(message);
      return confirmedHash
        ? { kind: "readback-failed", hash: confirmedHash, message, ...(outcome.verification ? { verification: outcome.verification } : {}) }
        : { kind: "failed", message };
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rows = workspaceRef.current?.querySelectorAll(".demand-row");
    if (!rows?.length) return;
    const animation = animate(Array.from(rows).slice(0, 8), { opacity: [0.5, 1], translateY: [6, 0], duration: 280, delay: stagger(24), ease: "out(3)" });
    return () => { animation.revert(); };
  }, [location.pathname, boardLoading]);

  const activity = account
    ? board.filter((demand) => demand.creator.toLowerCase() === account.toLowerCase()
      || demand.builder.toLowerCase() === account.toLowerCase()
      || mySupportIds.has(demand.demandId.toString()))
    : [];

  const routeIsDetail = location.pathname.startsWith(ROUTES.market.href + "/");
  const activeRoute = location.pathname === ROUTES.createDemand.href
    ? "create-demand"
    : location.pathname === ROUTES.myActivity.href
      ? "my-activity"
      : "market";
  const pageTitle = routeIsDetail
    ? "Demand Details"
    : activeRoute === "create-demand"
      ? "Create Demand"
      : activeRoute === "my-activity"
        ? "My Activity"
        : "Explore Market";

  const outletContext: AppOutletContext = {
    board,
    boardLoading,
    boardLoadError,
    selectedId,
    account,
    activity,
    activityState,
    support: currentSupport,
    supportState: currentSupportState,
    busy,
    lastTx,
    pendingCreate,
    run,
    verifyCreate,
    connect,
    refreshBoard: refreshBoardForCreate,
    walletStatus,
  };

  return (
    <div className="unmet-app-shell">
      <ReuiAppShell
        activeRoute={activeRoute}
        pageTitle={pageTitle}
        account={account}
        walletStatus={walletStatus}
        busy={busy}
        boardLoading={boardLoading}
        onConnect={() => void connect()}
        onRefresh={() => {
          const boardReadback = refresh();
          const supportReadback = account && selectedId !== null
            ? loadSupport(selectedId, account, supportIdentity)
            : Promise.resolve(null);
          void Promise.all([boardReadback, supportReadback]);
        }}
      >
        <div className={activeRoute === "create-demand" ? "legacy-content create-demand-content" : "legacy-content"}>
          <a className="skip-link" href="#workspace">{activeRoute === "create-demand" ? "Skip to Create Demand" : "Skip to Market Requests"}</a>
          <div className="status-stack">
            {account && !chainOk && <div className="status-line err">Wrong network · writes request X Layer {CHAIN_ID}.</div>}
            {supportError && <div role="alert" aria-live="polite" className="status-line err">{supportError}</div>}
            {boardError && <div role="alert" aria-live="polite" className="status-line err">{boardError}</div>}
            {status && <div role="status" aria-live="polite" className={"status-line " + (status.includes("FAILED") ? "err" : status.includes("success") || status.includes("confirmed") ? "ok" : transactionState === "reverted" || transactionState === "cancelled" || transactionState === "unknown" ? "err" : status.includes("pending") || transactionState === "broadcast" ? "" : "err")}>{status}</div>}
            {lastTx && <div className="status-line">tx <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer"><code>{lastTx}</code></a></div>}
          </div>

          <main id="workspace" ref={workspaceRef} className="workspace">
            <Outlet context={outletContext} />
          </main>

        </div>
      </ReuiAppShell>
    </div>
  );
}

export function MarketRoute() {
  const { board, boardLoading, boardLoadError, selectedId } = useOutletContext<AppOutletContext>();
  return (
    <DemandBoard
      board={board}
      loading={boardLoading}
      loadError={boardLoadError}
      selectedId={selectedId}
      contractConfigured={Boolean(DEMAND_CONTRACT)}
      detailFrom={ROUTES.market.href}
    />
  );
}

export function CreateDemandRoute() {
  const { account, busy, connect, pendingCreate, refreshBoard, run, verifyCreate, walletStatus } = useOutletContext<AppOutletContext>();
  return (
    <CreateDemandChat
      account={account}
      busy={busy}
      contractConfigured={Boolean(DEMAND_CONTRACT)}
      walletStatus={walletStatus}
      pendingTransaction={pendingCreate}
      onConnect={connect}
      onCreate={(input) => run("create", (onUpdate) => createDemand(input, onUpdate), input)}
      onVerify={verifyCreate}
      onRefreshBoard={refreshBoard}
    />
  );
}

export function MyActivityRoute() {
  const { account, activity, activityState, boardLoadError, selectedId } = useOutletContext<AppOutletContext>();

  return (
    <section className="panel activity-panel">
      <div className="board-title"><h1>My Activity</h1>{account && <span className="unit">{activity.length} requests</span>}</div>
      {!account ? <div className="empty">Connect a wallet to see your activity.</div>
        : !DEMAND_CONTRACT ? <div className="empty" role="alert">Wallet activity is unavailable because the demand contract is not configured.</div>
        : activityState === "loading" ? <div className="empty" role="status">Loading wallet activity…</div>
        : activityState === "error" || boardLoadError ? <div className="empty" role="alert">Could not read wallet activity. Refresh the chain view to retry.</div>
        : activity.length === 0 ? <div className="empty">No onchain activity for this wallet.</div>
        : <ActivityLedger board={activity} account={account} selectedId={selectedId} detailFrom={ROUTES.myActivity.href} />}
    </section>
  );
}

type DemandDetailLoad =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "not-configured" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "ready"; demand: DemandView };

export function DemandDetailRoute() {
  const { demandId: rawDemandId } = useParams();
  const demandId = parseDemandId(rawDemandId);
  const location = useLocation();
  const navigate = useNavigate();
  const { account, support, supportState, busy, lastTx, run } = useOutletContext<AppOutletContext>();
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DemandDetailLoad>({ kind: "loading" });
  const returnTo = demandReturnPath(location.state);
  const close = useCallback(() => navigate(returnTo), [navigate, returnTo]);

  useEffect(() => {
    let live = true;
    if (demandId === null) {
      setDetail({ kind: "invalid" });
      return () => { live = false; };
    }
    if (!DEMAND_CONTRACT) {
      setDetail({ kind: "not-configured" });
      return () => { live = false; };
    }
    setDetail({ kind: "loading" });
    void readDemandOnChain(demandId).then((demand) => {
      if (live) setDetail({ kind: "ready", demand });
    }).catch(async () => {
      try {
        const board = await readBoard();
        if (!live) return;
        setDetail(board.some((demand) => demand.demandId === demandId)
          ? { kind: "error" }
          : { kind: "not-found" });
      } catch {
        if (live) setDetail({ kind: "error" });
      }
    });
    return () => { live = false; };
  }, [demandId, attempt, lastTx]);

  if (detail.kind !== "ready") {
    const message = detail.kind === "loading"
      ? "Loading market request…"
      : detail.kind === "invalid"
        ? "This demand ID is invalid."
        : detail.kind === "not-configured"
          ? "The demand contract is not configured."
          : detail.kind === "not-found"
            ? "This market request was not found."
            : "Could not read this market request from X Layer. Check the connection and retry.";

    return (
      <section className="panel detail demand-page" aria-labelledby="demand-load-heading">
        <div className="detail-title">
          <h2 id="demand-load-heading" tabIndex={-1}>
            {detail.kind === "loading" ? "Loading Market Request" : "Market Request Unavailable"}
          </h2>
          <button className="ghost" onClick={close}>
            {returnTo === ROUTES.myActivity.href ? "Back to My Activity" : "Back to Market Requests"}
          </button>
        </div>
        <p className="empty" role={detail.kind === "loading" ? "status" : "alert"}>{message}</p>
        {detail.kind === "error" && (
          <div className="actions">
            <button className="primary" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
          </div>
        )}
      </section>
    );
  }

  return (
    <DemandDetail
      key={detail.demand.demandId.toString()}
      demand={detail.demand}
      support={support}
      supportState={supportState}
      account={account}
      busy={busy}
      close={close}
      closeLabel={returnTo === ROUTES.myActivity.href ? "Back to My Activity" : "Back to Market Requests"}
      run={run}
    />
  );
}

function demandReturnPath(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) return ROUTES.market.href;
  return state.from === ROUTES.myActivity.href ? ROUTES.myActivity.href : ROUTES.market.href;
}

function DemandBoard({ board, loading, loadError, selectedId, contractConfigured, detailFrom }: { board: DemandView[]; loading: boolean; loadError: boolean; selectedId: bigint | null; contractConfigured: boolean; detailFrom: string }) {
  return (
    <section className="panel market-panel">
      <div className="board-title"><div><h1>What the market needs<span className="count">{loading || loadError || !contractConfigured ? "—" : board.length}</span></h1><p className="workflow-summary">Requests backed by real escrow.</p></div><span className="unit">USD₮0</span></div>
      {loading ? <div className="empty" role="status">Loading market requests…</div>
        : !contractConfigured ? <div className="empty error" role="alert">Market data is unavailable because the demand contract is not configured.</div>
        : loadError ? <div className="empty error" role="alert">Could not load market requests. Refresh to try again.</div>
        : board.length === 0 ? <div className="empty">No funded market requests yet.</div>
        : <DemandTable board={board} selectedId={selectedId} detailFrom={detailFrom} />}
    </section>
  );
}

function DemandTable({ board, selectedId, detailFrom }: { board: DemandView[]; selectedId: bigint | null; detailFrom: string }) {
  return <table className="demand-table">
    <thead><tr><th>Capability</th><th>Escrow</th><th>Expected calls</th><th>Wallets</th><th>Max / call</th><th>Status</th></tr></thead>
    <tbody>{board.map((demand) => <DemandCard key={demand.demandId.toString()} demand={demand} selected={selectedId === demand.demandId} detailFrom={detailFrom} />)}</tbody>
  </table>;
}

function ActivityLedger({ board, account, selectedId, detailFrom }: { board: DemandView[]; account: Address; selectedId: bigint | null; detailFrom: string }) {
  const entries = [...board].sort((a, b) => a.demandId > b.demandId ? -1 : a.demandId < b.demandId ? 1 : 0);
  return <ol className="activity-ledger">
    {entries.map((demand) => {
      const roles = [
        demand.creator.toLowerCase() === account.toLowerCase() ? "Creator" : "",
        demand.builder.toLowerCase() === account.toLowerCase() ? "Builder" : "",
      ].filter(Boolean);
      return <li className={"activity-entry " + (selectedId === demand.demandId ? "selected" : "")} key={demand.demandId.toString()}>
        <span className="activity-role">{roles.length ? roles.join(" · ") : "Supporter"}</span>
        <Link className="activity-demand" to={demandHref(demand.demandId)} state={{ from: detailFrom }}>
          <span className="demand-id">#{demand.demandId.toString().padStart(3, "0")}</span><strong>{demand.capability}</strong>
        </Link>
        <span className="activity-amount"><small>Escrow</small>{formatUsd0(demand.committed)} USD₮0</span>
        <span className={"badge " + effectiveStatus(demand)}>{effectiveStatus(demand)}</span>
      </li>;
    })}
  </ol>;
}

function DemandCard({ demand, selected, detailFrom }: { demand: DemandView; selected: boolean; detailFrom: string }) {
  const state = effectiveStatus(demand);
  return (
    <tr className={"demand-row " + (selected ? "selected" : "")}>
      <td className="capability">
        <Link
          to={demandHref(demand.demandId)}
          state={{ from: detailFrom }}
          aria-label={"View Market Request #" + demand.demandId.toString() + ": " + demand.capability}
        >
          <span className="demand-id">#{demand.demandId.toString().padStart(3, "0")}</span>
          <strong>{demand.capability}</strong>
          <span className="row-open" aria-hidden="true">View</span>
        </Link>
      </td>
      <td data-label="Escrow" className="number">{formatUsd0(demand.committed)}</td>
      <td data-label="Expected calls" className="number">{demand.expectedCalls.toLocaleString("en-US")}</td>
      <td data-label="Wallets" className="number">{demand.supporterCount}</td>
      <td data-label="Max / call" className="number">{formatUsd0(demand.maxUnitPrice)}</td>
      <td data-label="Status"><span className={"badge " + state}>{state}</span></td>
    </tr>
  );
}

function DemandDetail({
  demand, support, supportState, account, busy, close, closeLabel, run,
}: {
  demand: DemandView;
  support: SupportView;
  supportState: "loading" | "ready" | "error";
  account: Address | null;
  busy: boolean;
  close: () => void;
  closeLabel: string;
  run: (label: string, fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>) => Promise<CreateDemandRunOutcome>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeView, setActiveView] = useState<"overview" | "fund" | "build-review">("overview");
  const [supportAmount, setSupportAmount] = useState("0.05");
  const [supportCalls, setSupportCalls] = useState("1000");
  const [serviceUrl, setServiceUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const views = [
    { id: "overview", label: "Request Details" },
    { id: "fund", label: "Escrow & Support" },
    { id: "build-review", label: "Builder Proposal" },
  ] as const;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLHeadingElement>("h2")?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !panel) return;
    const animation = animate(panel, { opacity: [0.6, 1], translateX: [12, 0], duration: 240, ease: "out(3)" });
    return () => { animation.revert(); };
  }, [demand.demandId]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const state = effectiveStatus(demand, now);
  const reviewExpired = demand.status === 1 && demand.reviewEndsAt <= now;
  const canReopen = (reviewExpired || demand.candidateRejected) && !demand.quorumReached && demand.deadline > now;
  const safeUrl = safeHttpsUrl(demand.serviceUrl);
  const hasProposal = demand.serviceUrl.length > 0;
  const percent = demand.approvalRequired === 0n ? 0 : Math.min(100, Number((demand.approvalWeight * 10_000n) / demand.approvalRequired) / 100);
  const rejectionPercent = demand.rejectionThreshold === 0n ? 0 : Math.min(100, Number((demand.rejectionWeight * 10_000n) / demand.rejectionThreshold) / 100);

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const nextIndex = (index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length;
    setActiveView(views[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section ref={panelRef} className="panel detail demand-page" aria-label="Market Request details">
      <div className="detail-title">
        <div>
          <h2 tabIndex={-1}><span className="demand-id">Market Request #{demand.demandId.toString()}</span>{demand.capability}</h2>
          <p className="workflow-summary">A market need backed by real escrow.</p>
        </div>
        <button className="ghost" onClick={close}>{closeLabel}</button>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Market Request sections">
        {views.map((view, index) => (
          <button
            key={view.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={`demand-tab-${view.id}`}
            className={`nav-item ${activeView === view.id ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeView === view.id}
            aria-controls={`demand-panel-${view.id}`}
            tabIndex={activeView === view.id ? 0 : -1}
            onClick={() => setActiveView(view.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >{view.label}</button>
        ))}
      </div>
      <div className="demand-tab-panels">
        <div id="demand-panel-overview" className="demand-tab-panel" role="tabpanel" aria-labelledby="demand-tab-overview" tabIndex={0} hidden={activeView !== "overview"}>
          <section className="action-block" aria-labelledby="request-heading">
            <h3 id="request-heading">What is needed</h3>
            <dl>
              <dt>Capability</dt><dd>{demand.capability}</dd>
              <dt>Specification</dt><dd>{demand.specification}</dd>
              <dt>Creator</dt><dd>{demand.creator}</dd>
              <dt>Deadline</dt><dd>{iso(demand.deadline)}</dd>
            </dl>
          </section>
          <section className="action-block" aria-labelledby="market-heading">
            <h3 id="market-heading">Market</h3>
            <dl>
              <dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} USD₮0</dd>
              <dt>Supporting wallets</dt><dd>{demand.supporterCount}</dd>
              <dt>Expected calls</dt><dd>{demand.expectedCalls.toString()}</dd>
              <dt>Max unit price</dt><dd>{formatUsd0(demand.maxUnitPrice)} USD₮0</dd>
              <dt>Status</dt><dd>{state}</dd>
            </dl>
          </section>
        </div>
        <div id="demand-panel-fund" className="demand-tab-panel" role="tabpanel" aria-labelledby="demand-tab-fund" tabIndex={0} hidden={activeView !== "fund"}>
          <section className="action-block" aria-labelledby="escrow-heading">
            <h3 id="escrow-heading">Market backing</h3>
            <dl>
              <dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} USD₮0</dd>
              <dt>Supporting wallets</dt><dd>{demand.supporterCount}</dd>
              <dt>Your commitment</dt><dd>{account ? `${formatUsd0(support.commitment)} USD₮0` : "connect wallet"}</dd>
              {account && supportState === "loading" && <><dt>Wallet position</dt><dd role="status">Loading your onchain position…</dd></>}
              {account && supportState === "error" && <><dt>Wallet position</dt><dd role="alert">Could not read your position. Refresh the chain view before voting or refunding.</dd></>}
            </dl>
            {state === "OPEN" && (
              <div className="action-block">
                <h3>Support this request</h3>
                <label>Amount (USD₮0)<input value={supportAmount} onChange={(e) => setSupportAmount(e.target.value)} /></label>
                <label>Expected calls<input value={supportCalls} onChange={(e) => setSupportCalls(e.target.value)} /></label>
                <button className="primary" disabled={busy || !account} onClick={() => void run("support", (onUpdate) => supportDemand(demand.demandId, supportAmount, supportCalls, onUpdate))}>Support This Request</button>
              </div>
            )}
            {supportState === "ready" && support.refundable && (
              <div className="actions"><button className="danger" disabled={busy || !account} onClick={() => void run("refund", (onUpdate) => refundDemand(demand.demandId, onUpdate))}>Refund {formatUsd0(support.commitment)} USD₮0</button></div>
            )}
          </section>
        </div>
        <div id="demand-panel-build-review" className="demand-tab-panel" role="tabpanel" aria-labelledby="demand-tab-build-review" tabIndex={0} hidden={activeView !== "build-review"}>
          <section className="action-block" aria-labelledby="builder-proposal-heading">
            <h3 id="builder-proposal-heading">Builder Proposal</h3>
            {!hasProposal && state === "OPEN" && <p className="workflow-summary">Built a solution? Submit the service here.</p>}
          </section>
          {hasProposal ? (
            <section className="action-block" aria-labelledby="proposal-heading">
              <h3 id="proposal-heading">Current proposal</h3>
              <dl>
                <dt>Builder</dt><dd>{demand.builder}</dd>
                <dt>Service URL</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{safeUrl}</a> : demand.serviceUrl}</dd>
                <dt>Evidence</dt><dd>{demand.evidenceHash}</dd>
              </dl>
            </section>
          ) : state === "OPEN" ? (
            <section className="action-block" aria-labelledby="submit-service-heading">
              <h3 id="submit-service-heading">Submit a service</h3>
              <div className="action-block">
                <label>Service URL<input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://service.example/api" /></label>
                <label htmlFor="proposal-evidence">Evidence</label>
                <textarea id="proposal-evidence" aria-describedby="proposal-evidence-help" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                <p className="workflow-summary" id="proposal-evidence-help">Proof that the service fulfills this request.</p>
                <button className="primary" disabled={busy || !account} onClick={() => void run("submit", (onUpdate) => submitService(demand.demandId, serviceUrl, evidence, onUpdate))}>Submit Service Proposal</button>
              </div>
            </section>
          ) : null}
          {demand.status === 1 && (
            <section className="action-block" aria-labelledby="review-heading">
              <h3 id="review-heading">Review</h3>
              <dl>
                <dt>Review snapshot</dt><dd>{formatUsd0(demand.reviewCommitted)} USD₮0</dd>
                <dt>Review end</dt><dd>{demand.reviewEndsAt === 0n ? "—" : iso(demand.reviewEndsAt)}</dd>
                <dt>Approval progress</dt>
                <dd>
                  {formatUsd0(demand.approvalWeight)} / {formatUsd0(demand.approvalRequired)} USD₮0
                  <div className="progress"><span style={{ width: `${percent}%` }} /></div>
                  <span className="muted">Only approver funds settle.</span>
                </dd>
                <dt>Rejection progress</dt>
                <dd>{formatUsd0(demand.rejectionWeight)} / {formatUsd0(demand.rejectionThreshold)} USD₮0<div className="progress rejection"><span style={{ width: `${rejectionPercent}%` }} /></div></dd>
              </dl>
              <div className="actions actions-column">
                {!reviewExpired && supportState === "ready" && support.commitment > 0n && !support.approved && !support.rejected && (
                  <>
                    <button className="primary" disabled={busy || !account} onClick={() => void run("approve", (onUpdate) => approveService(demand.demandId, onUpdate))}>Approve Proposal</button>
                    <button className="danger" disabled={busy || !account} onClick={() => void run("reject", (onUpdate) => rejectService(demand.demandId, onUpdate))}>Reject Proposal</button>
                  </>
                )}
                {supportState === "ready" && support.approved && <span className="status-line ok">Approved · commitment eligible for settlement.</span>}
                {supportState === "ready" && support.rejected && <span className="status-line err">Proposal rejected.</span>}
              </div>
            </section>
          )}
          {(demand.status === 1 && demand.quorumReached || canReopen) && (
            <section className="action-block" aria-labelledby="settlement-heading">
              <h3 id="settlement-heading">Settlement</h3>
              <div className="actions actions-column">
                {demand.status === 1 && demand.quorumReached && (
                  <button className="primary" disabled={busy} onClick={() => void run("finalize", (onUpdate) => finalizeDemand(demand.demandId, onUpdate))}>Finalize Payout</button>
                )}
                {canReopen && (
                  <button className="ghost" disabled={busy || !account} onClick={() => void run("reopen", (onUpdate) => reopenDemand(demand.demandId, onUpdate))}>Reopen Demand</button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}


function safeHttpsUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function iso(value: bigint): string {
  const millis = value * 1000n;
  const maxDateMillis = 8_640_000_000_000_000n;
  return millis > maxDateMillis || millis < -maxDateMillis
    ? "Outside displayable date range"
    : new Date(Number(millis)).toISOString();
}
function short(value: string): string { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
