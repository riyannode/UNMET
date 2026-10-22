import { animate, stagger } from "animejs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router";
import { getAddress, isAddress, type Address, type Hash } from "viem";
import type { AppKit } from "@reown/appkit/react";
import { ArrowUpDown, ChevronDown, CircleCheck, CircleHelp, CircleX, Clock3, MoreVertical, Search } from "lucide-react";
import {
  CHAIN_ID,
  DEMAND_CONTRACT,
  MARKET_SYNC_INTERVAL_MS,
  approveService,
  createDemand,
  getPublic,
  readTransactionOnChain,
  effectiveStatus,
  explorerTx,
  finalizeDemand,
  formatUsd0,
  parseUsd0,
  readBoardSnapshot,
  readSupport,
  synchronizeMarketBoard,
  refundDemand,
  rejectService,
  reopenDemand,
  statusName,
  submitService,
  supportDemand,
  verifyTransaction,
  setReownWalletProvider,
  type DemandView,
  type MarketSyncCursor,
  type SupportView,
} from "./contract.ts";
import {
  afterConfirmedTransaction,
  deriveMarketRequests,
  readSupportForIdentity,
  settleBoardRead,
  settleSupportRead,
  nextMarketStatusChangeAt,
  type MarketSort,
  type SupportReadResult,
} from "./app-state.ts";
import { Badge } from "./components/reui/badge.tsx";
import { AvatarGroup, AvatarGroupCount } from "./components/ui/avatar.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "./components/ui/empty.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "./components/ui/input-group.tsx";
import { Input } from "./components/ui/input.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { ReuiAppShell } from "./components/examples/c-sidebar-1.tsx";
import { CreateDemandChat, type CreateDemandRunOutcome, type CreateDemandTransactionOutcome } from "./CreateDemandChat";
import { normalizeCapability } from "./capability";
import { resolveUniqueCreatedDemandId } from "./create-demand-chat-model";
import type { CreatedDemandVerification, DemandReadbackMatch } from "./create-demand-chat-model";
import {
  CREATE_DEMAND_ACTION_ID,
  findPendingTransaction,
  readLegacyPendingCreate,
  readPendingTransactions,
  recoverLegacyPendingCreate,
  removePendingTransaction,
  storePendingTransaction,
  TransactionLifecycleError,
  transactionFailureOutcome,
  type LegacyPendingCreate,
  type PendingTransactionRecord,
  type TransactionFailureOutcome,
  type TransactionState,
  type TransactionUpdateHandler,
} from "./transaction-lifecycle";
import { demandHref, parseDemandId, ROUTES } from "./routing.ts";
import { AnalyticsDashboard } from "./Analytics";
import { errorMessage } from "./errors.ts";
import { resolveReownStatus, type ReownStatus } from "./reown-status.ts";
type CreateDemandInput = Parameters<typeof createDemand>[0];
type CreateDemandPendingTransactionRecord = PendingTransactionRecord & {
  actionId: typeof CREATE_DEMAND_ACTION_ID;
  stage: "approval" | "demand";
};
type AppTransactionOutcome = CreateDemandRunOutcome | TransactionFailureOutcome;
type RunHandler = {
  (label: "create", actionId: typeof CREATE_DEMAND_ACTION_ID, fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>, createdDemand?: CreateDemandInput): Promise<CreateDemandRunOutcome>;
  (label: string, actionId: string, fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>, createdDemand?: CreateDemandInput): Promise<AppTransactionOutcome>;
};
type VerifyPendingHandler = {
  (record: CreateDemandPendingTransactionRecord): Promise<CreateDemandRunOutcome>;
  (record: PendingTransactionRecord): Promise<AppTransactionOutcome>;
};

const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();
const EMPTY_SUPPORT: SupportView = { commitment: 0n, expectedCalls: 0n, approved: false, rejected: false, refundable: false };
const MARKET_STATUSES = ["OPEN", "SUBMITTED", "READY", "EXPIRED", "REJECTED", "FULFILLED", "CLOSED"] as const;
const MARKET_SORTS = [
  { value: "most-funded", label: "Most Funded" },
  { value: "least-funded", label: "Least Funded" },
  { value: "latest-id", label: "Latest Request ID" },
  { value: "earliest-id", label: "Earliest Request ID" },
] as const satisfies readonly { value: MarketSort; label: string }[];
type TransactionPersistenceState = {
  records: PendingTransactionRecord[];
  legacy: LegacyPendingCreate | null;
  warning: string | null;
};

function transactionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readTransactionPersistence(): TransactionPersistenceState {
  const storage = transactionStorage();
  const pending = readPendingTransactions(storage);
  const legacy = readLegacyPendingCreate(storage);
  const warning = !pending.available || !legacy.available
    ? "Transaction recovery storage is unavailable. Pending details may be lost if this tab reloads."
    : pending.invalidRecords > 0 || legacy.invalid
      ? "An unreadable saved transaction record was preserved in this tab, but it cannot be safely verified."
      : legacy.record
        ? "An older unresolved transaction was found. Its sender and intent must match a wallet on X Layer before it can be restored."
        : null;
  return { records: pending.records, legacy: legacy.record, warning };
}

function upsertPendingRecord(records: readonly PendingTransactionRecord[], next: PendingTransactionRecord): PendingTransactionRecord[] {
  return [
    ...records.filter((record) =>
      record.wallet.toLowerCase() !== next.wallet.toLowerCase()
      || record.chainId !== next.chainId
      || record.actionId !== next.actionId,
    ),
    next,
  ];
}

function withoutPendingRecord(records: readonly PendingTransactionRecord[], target: PendingTransactionRecord): PendingTransactionRecord[] {
  return records.filter((record) =>
    record.wallet.toLowerCase() !== target.wallet.toLowerCase()
    || record.chainId !== target.chainId
    || record.actionId !== target.actionId,
  );
}

function createOutcomeFromPending(record: CreateDemandPendingTransactionRecord, message?: string): CreateDemandTransactionOutcome {
  return {
    kind: record.state,
    stage: record.stage === "approval" ? "approval" : "demand",
    hash: record.hash,
    intent: record.intent,
    message: message ?? "The transaction receipt has not been verified yet.",
    ...(record.verification ? { verification: record.verification } : {}),
  };
}

function pendingActionLabel(label: string): string {
  switch (label) {
    case "create": return "Create Demand";
    case "support": return "Support Demand";
    case "submit": return "Submit Service";
    case "approve": return "Approve Service";
    case "reject": return "Reject Service";
    case "finalize": return "Finalize";
    case "reopen": return "Reopen Demand";
    case "refund": return "Refund";
    default: return label;
  }
}

function transactionOutcomeFromError(
  error: TransactionLifecycleError,
  actionId: string,
  verification?: CreatedDemandVerification,
): AppTransactionOutcome {
  if (actionId === CREATE_DEMAND_ACTION_ID && error.stage !== "action") {
    return {
      kind: error.state,
      stage: error.stage,
      hash: error.hash,
      intent: error.intent,
      message: error.message,
      ...(verification ? { verification } : {}),
    };
  }
  return transactionFailureOutcome(error, actionId);
}

type AppOutletContext = {
  board: DemandView[];
  boardLoading: boolean;
  boardLoadError: boolean;
  selectedId: bigint | null;
  account: Address | null;
  support: SupportView;
  supportState: "loading" | "ready" | "error";
  busy: boolean;
  lastTx: Hash | null;
  pendingCreate: CreateDemandTransactionOutcome | null;
  blockedActionIds: string[];
  run: RunHandler;
  verifyPendingTransaction: VerifyPendingHandler;
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
  const marketPollInFlightRef = useRef(false);
  const marketSyncCursorRef = useRef<MarketSyncCursor | null>(null);
  const marketSyncGenerationRef = useRef(0);
  const boardRefreshRequestRef = useRef(0);
  const initialBoardLoadStartedRef = useRef(false);
  const [boardLoading, setBoardLoadingState] = useState(true);
  const boardLoadingRef = useRef(boardLoading);
  boardLoadingRef.current = boardLoading;
  const [walletKit, setWalletKit] = useState<AppKit | null>(null);
  const [walletModuleLoaded, setWalletModuleLoaded] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const currentWalletIdentity = account?.toLowerCase() ?? null;
  const activeWalletIdentityRef = useRef(currentWalletIdentity);
  const previousWalletIdentityRef = useRef(currentWalletIdentity);
  activeWalletIdentityRef.current = currentWalletIdentity;
  const [chainOk, setChainOk] = useState(true);
  const [support, setSupport] = useState<SupportView>(EMPTY_SUPPORT);
  const [supportKey, setSupportKey] = useState("");
  const [supportState, setSupportState] = useState<"loading" | "ready" | "error">("ready");
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [marketClock, setMarketClock] = useState(0);
  const [readStatus, setReadStatus] = useState({ actionStatus: "", boardError: "", supportError: "" });
  const { actionStatus: status, boardError, supportError } = readStatus;
  const boardLoadError = boardError !== "";
  const [lastTx, setLastTx] = useState<Hash | null>(null);
  const [lastTxWallet, setLastTxWallet] = useState<string | null>(null);
  const [transactionState, setTransactionState] = useState<TransactionState | null>(null);
  const [transactionPersistence, setTransactionPersistence] = useState(readTransactionPersistence);
  const recordsRef = useRef(transactionPersistence.records);
  recordsRef.current = transactionPersistence.records;
  const activeActionLocksRef = useRef(new Set<string>());
  const walletStatus = resolveReownStatus(Boolean(reownProjectId), walletModuleLoaded, Boolean(walletKit));
  const setStatus = useCallback((actionStatus: string) => {
    setReadStatus((current) => ({ ...current, actionStatus }));
  }, []);
  const setBoardLoading = useCallback((next: boolean) => {
    boardLoadingRef.current = next;
    if (next) marketSyncGenerationRef.current += 1;
    setBoardLoadingState(next);
  }, []);
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    if (next) marketSyncGenerationRef.current += 1;
    setBusyState(next);
  }, []);

  useEffect(() => {
    if (previousWalletIdentityRef.current === currentWalletIdentity) return;
    previousWalletIdentityRef.current = currentWalletIdentity;
    setLastTx(null);
    setLastTxWallet(null);
    setTransactionState(null);
    setStatus("");
  }, [currentWalletIdentity, setStatus]);

  const supportIdentity = account && selectedId !== null ? account.toLowerCase() + ":" + selectedId.toString() : "";
  const supportIdentityRef = useRef(supportIdentity);
  supportIdentityRef.current = supportIdentity;
  const supportRequestRef = useRef(0);
  const marketSyncRoute = location.pathname === ROUTES.market.href
    || location.pathname === ROUTES.analytics.href
    || demandMatch !== null;
  const currentSupport = supportIdentity !== "" && supportKey === supportIdentity ? support : EMPTY_SUPPORT;
  const currentSupportState = supportIdentity === "" ? "ready" : supportKey === supportIdentity ? supportState : "loading";
  const pendingTransactions = transactionPersistence.records.filter((record) =>
    account !== null
    && record.wallet.toLowerCase() === account.toLowerCase()
    && record.chainId === CHAIN_ID,
  );
  const pendingCreateRecord = pendingTransactions.find(
    (record): record is CreateDemandPendingTransactionRecord =>
      record.actionId === CREATE_DEMAND_ACTION_ID && record.stage !== "action",
  ) ?? null;
  const pendingCreate = useMemo(
    () => pendingCreateRecord ? createOutcomeFromPending(pendingCreateRecord) : null,
    [pendingCreateRecord],
  );
  const blockedActionIds = pendingTransactions.map(({ actionId }) => actionId);

  function updatePendingRecord(record: PendingTransactionRecord | null, target: PendingTransactionRecord) {
    const storage = transactionStorage();
    const saved = record ? storePendingTransaction(storage, record) : removePendingTransaction(storage, target);
    const records = record
      ? upsertPendingRecord(recordsRef.current, record)
      : withoutPendingRecord(recordsRef.current, target);
    recordsRef.current = records;
    setTransactionPersistence((current) => ({
      ...current,
      records,
      warning: saved ? current.warning : "Transaction recovery storage is unavailable. Pending details may be lost if this tab reloads.",
    }));
  }

  function createTransactionUpdateHandler(
    label: string,
    actionId: string,
    verification?: CreatedDemandVerification,
    baseRecord?: PendingTransactionRecord,
    actionStageLabel = "action",
  ): TransactionUpdateHandler {
    return ({ stage, state, hash, intent, wallet, chainId }) => {
      setLastTx(hash);
      setLastTxWallet(wallet.toLowerCase());
      setTransactionState(state);
      if (activeWalletIdentityRef.current === wallet.toLowerCase()) {
        const statusStage = stage === "action" ? actionStageLabel : stage;
        setStatus(label + " " + statusStage + " " + (state === "broadcast" ? "pending" : state));
      }
      const savedVerification = verification ?? baseRecord?.verification;
      const target: PendingTransactionRecord = {
        ...baseRecord,
        wallet,
        chainId,
        actionId,
        actionLabel: baseRecord?.actionLabel ?? label,
        stage,
        state: state === "unknown" ? "unknown" : "broadcast",
        hash,
        intent,
        ...(savedVerification ? { verification: savedVerification } : {}),
      };
      updatePendingRecord(state === "broadcast" || state === "unknown" ? target : null, target);
    };
  }

  useEffect(() => {
    const legacy = transactionPersistence.legacy;
    if (!legacy || !account) return;
    let live = true;
    void readTransactionOnChain(legacy.hash).then((observed) => {
      if (!live) return;
      const recovered = recoverLegacyPendingCreate(legacy, observed, account, CHAIN_ID);
      if (!recovered) return;
      const storage = transactionStorage();
      const saved = storePendingTransaction(storage, recovered);
      const records = upsertPendingRecord(recordsRef.current, recovered);
      recordsRef.current = records;
      if (saved && storage) {
        try { storage.removeItem("unmet.pending-create-transaction"); } catch { /* preserve the recovered in-memory record */ }
      }
      const refreshedLegacy = saved ? readLegacyPendingCreate(storage) : { record: legacy, available: Boolean(storage), invalid: false };
      setTransactionPersistence((current) => ({
        ...current,
        records,
        legacy: refreshedLegacy.record,
        warning: saved ? (refreshedLegacy.invalid ? current.warning : null) : "Transaction recovery storage is unavailable. Pending details may be lost if this tab reloads.",
      }));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [account, transactionPersistence.legacy]);

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
    const request = ++boardRefreshRequestRef.current;
    setBoardLoading(true);
    try {
      const snapshot = await readBoardSnapshot();
      if (request !== boardRefreshRequestRef.current) return false;
      marketSyncCursorRef.current = snapshot.cursor;
      boardRef.current = snapshot.demands;
      setBoard(snapshot.demands);
      setReadStatus((current) => settleBoardRead(current, { kind: "success" }));
      return true;
    } catch (error) {
      if (request !== boardRefreshRequestRef.current) return false;
      setReadStatus((current) => settleBoardRead(current, { kind: "error", message: errorMessage(error) }));
      return false;
    } finally {
      if (request === boardRefreshRequestRef.current) setBoardLoading(false);
    }
  }, []);

  const refreshBoardForCreate = useCallback(async (): Promise<readonly DemandReadbackMatch[] | null> => {
    return await refresh() ? boardRef.current : null;
  }, [refresh]);

  const synchronizeMarket = useCallback(async (): Promise<void> => {
    const cursor = marketSyncCursorRef.current;
    if (
      !DEMAND_CONTRACT || !cursor || marketPollInFlightRef.current || boardLoadingRef.current || busyRef.current
      || activeActionLocksRef.current.size > 0 || document.visibilityState !== "visible"
    ) return;

    const generation = marketSyncGenerationRef.current;
    marketPollInFlightRef.current = true;
    try {
      const result = await synchronizeMarketBoard(getPublic(), DEMAND_CONTRACT, boardRef.current, cursor);
      if (
        generation !== marketSyncGenerationRef.current || boardLoadingRef.current || busyRef.current
        || activeActionLocksRef.current.size > 0
      ) return;
      marketSyncCursorRef.current = result.cursor;
      if (result.changed) {
        boardRef.current = result.demands;
        setBoard(result.demands);
      }
      setReadStatus((current) => current.boardError ? settleBoardRead(current, { kind: "success" }) : current);
    } catch (error) {
      if (generation !== marketSyncGenerationRef.current || boardLoadingRef.current || busyRef.current) return;
      const message = errorMessage(error);
      setReadStatus((current) => current.boardError === message ? current : settleBoardRead(current, { kind: "error", message }));
    } finally {
      marketPollInFlightRef.current = false;
    }
  }, []);

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
    if (initialBoardLoadStartedRef.current) return;
    initialBoardLoadStartedRef.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
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
  }, [syncWallet, walletKit]);

  useEffect(() => {
    if (!marketSyncRoute || boardLoading || busy) return;
    let live = true;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => { void poll(); }, MARKET_SYNC_INTERVAL_MS);
    };
    const poll = async () => {
      if (!live || document.visibilityState !== "visible") return;
      await synchronizeMarket();
      if (live && document.visibilityState === "visible") schedule();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
      } else {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") void poll();
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [marketSyncRoute, boardLoading, busy, synchronizeMarket]);

  useEffect(() => {
    if (!marketSyncRoute) return;
    const nextChange = nextMarketStatusChangeAt(board, BigInt(Math.floor(Date.now() / 1000)));
    if (nextChange === null) return;
    const remainingMs = Number(nextChange * 1000n - BigInt(Date.now()));
    const maxTimeoutMs = 2_147_483_647;
    const timer = window.setTimeout(
      () => setMarketClock((current) => current + 1),
      Math.min(Math.max(remainingMs, 0), maxTimeoutMs),
    );
    return () => window.clearTimeout(timer);
  }, [marketSyncRoute, board, marketClock]);

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

  function run(
    label: "create",
    actionId: typeof CREATE_DEMAND_ACTION_ID,
    fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>,
    createdDemand?: CreateDemandInput,
  ): Promise<CreateDemandRunOutcome>;
  function run(
    label: string,
    actionId: string,
    fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>,
    createdDemand?: CreateDemandInput,
  ): Promise<AppTransactionOutcome>;
  async function run(
    label: string,
    actionId: string,
    fn: (onUpdate: TransactionUpdateHandler) => Promise<Hash>,
    createdDemand?: CreateDemandInput,
  ): Promise<AppTransactionOutcome> {
    const lockKey = `${account?.toLowerCase() ?? "disconnected"}:${CHAIN_ID}:${actionId}`;
    const storagePending = account
      ? findPendingTransaction(readPendingTransactions(transactionStorage()).records, account, CHAIN_ID, actionId)
      : null;
    const inMemoryPending = account ? findPendingTransaction(recordsRef.current, account, CHAIN_ID, actionId) : null;
    const existingPending = storagePending ?? inMemoryPending;
    if (existingPending) {
      if (actionId === CREATE_DEMAND_ACTION_ID && existingPending.stage !== "action") {
        return createOutcomeFromPending({
          ...existingPending,
          actionId: CREATE_DEMAND_ACTION_ID,
          stage: existingPending.stage,
        });
      }
      return { kind: "failed", message: `${pendingActionLabel(label)} already has an unresolved transaction. Verify it before trying again.` };
    }
    if (activeActionLocksRef.current.has(lockKey)) {
      return { kind: "failed", message: `${pendingActionLabel(label)} is already being submitted.` };
    }
    activeActionLocksRef.current.add(lockKey);
    setBusy(true);
    setStatus(label + " pending");
    setLastTx(null);
    setLastTxWallet(null);
    setTransactionState(null);
    const supportSnapshot = account && selectedId !== null
      ? { demandId: selectedId, supporter: account, identity: supportIdentity }
      : null;
    const boardBeforeTransaction = boardRef.current;
    let confirmedHash: Hash | null = null;
    let verification: CreatedDemandVerification | undefined;
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
      const onUpdate = createTransactionUpdateHandler(label, actionId, verification, undefined, "transaction");
      const readback = await afterConfirmedTransaction(
        () => fn(onUpdate),
        (hash) => {
          confirmedHash = hash;
          setLastTx(hash);
          setTransactionState("confirmed");
        },
        refresh,
        async () => supportSnapshot
          ? loadSupport(supportSnapshot.demandId, supportSnapshot.supporter, supportSnapshot.identity)
          : null,
      );
      await syncWallet();
      if (!readback.boardReadbackSucceeded) {
        if (activeWalletIdentityRef.current === account?.toLowerCase()) setStatus("CHAIN_STATE_READBACK_FAILED");
        return confirmedHash
          ? { kind: "readback-failed", hash: confirmedHash, ...(verification ? { verification } : {}) }
          : { kind: "failed", message: "The transaction result could not be verified." };
      }

      const demandId = verification
        ? resolveUniqueCreatedDemandId(verification.before, boardRef.current, verification.expected)
        : null;
      if (activeWalletIdentityRef.current === account?.toLowerCase()) setStatus(label + " success");
      return confirmedHash
        ? { kind: "confirmed", hash: confirmedHash, demandId, ...(verification ? { verification } : {}) }
        : { kind: "failed", message: "The transaction hash was not available." };
    } catch (error) {
      if (error instanceof TransactionLifecycleError) {
        setLastTx(error.hash);
        setTransactionState(error.state);
        if (activeWalletIdentityRef.current === error.wallet.toLowerCase()) setStatus(`${label} ${error.stage} ${error.state}`);
        return transactionOutcomeFromError(error, actionId, verification);
      }
      const message = errorMessage(error);
      if (activeWalletIdentityRef.current === account?.toLowerCase()) setStatus(message);
      return confirmedHash
        ? { kind: "readback-failed", hash: confirmedHash, message }
        : { kind: "failed", message };
    } finally {
      activeActionLocksRef.current.delete(lockKey);
      setBusy(false);
    }
  }

  function verifyPendingTransaction(record: CreateDemandPendingTransactionRecord): Promise<CreateDemandRunOutcome>;
  function verifyPendingTransaction(record: PendingTransactionRecord): Promise<AppTransactionOutcome>;
  async function verifyPendingTransaction(record: PendingTransactionRecord): Promise<AppTransactionOutcome> {
    if (account?.toLowerCase() !== record.wallet.toLowerCase()) {
      return { kind: "failed", message: "Connect the wallet that sent this transaction before verifying it." };
    }
    if (!chainOk || record.chainId !== CHAIN_ID) {
      return { kind: "failed", message: `Switch to X Layer ${CHAIN_ID} before verifying this transaction.` };
    }
    const lockKey = `${record.wallet.toLowerCase()}:${record.chainId}:${record.actionId}`;
    if (activeActionLocksRef.current.has(lockKey)) {
      return { kind: "failed", message: "This transaction is already being checked." };
    }
    activeActionLocksRef.current.add(lockKey);
    setBusy(true);
    const displayLabel = pendingActionLabel(record.actionLabel);
    setStatus(`${displayLabel} ${record.stage} verification pending`);
    setLastTx(record.hash);
    setLastTxWallet(record.wallet.toLowerCase());
    setTransactionState("broadcast");
    const supportSnapshot = account && selectedId !== null
      ? { demandId: selectedId, supporter: account, identity: supportIdentity }
      : null;
    let confirmedHash: Hash | null = null;
    try {
      const onUpdate = createTransactionUpdateHandler(displayLabel, record.actionId, record.verification, record);
      if (record.stage === "approval") {
        const hash = await verifyTransaction(record.stage, record.hash, record.intent, record.wallet, record.chainId, onUpdate);
        if (activeWalletIdentityRef.current === record.wallet.toLowerCase()) {
          const action = record.actionId === CREATE_DEMAND_ACTION_ID ? "demand" : "support";
          setStatus(`${displayLabel} token approval confirmed. No ${action} was submitted.`);
        }
        return { kind: "approval-confirmed", hash };
      }

      const readback = await afterConfirmedTransaction(
        () => verifyTransaction(record.stage, record.hash, record.intent, record.wallet, record.chainId, onUpdate),
        (hash) => {
          confirmedHash = hash;
          setLastTx(hash);
          setTransactionState("confirmed");
        },
        refresh,
        async () => supportSnapshot
          ? loadSupport(supportSnapshot.demandId, supportSnapshot.supporter, supportSnapshot.identity)
          : null,
      );
      await syncWallet();
      if (!readback.boardReadbackSucceeded) {
        if (activeWalletIdentityRef.current === record.wallet.toLowerCase()) setStatus("CHAIN_STATE_READBACK_FAILED");
        return confirmedHash
          ? { kind: "readback-failed", hash: confirmedHash, ...(record.verification ? { verification: record.verification } : {}) }
          : { kind: "failed", message: "The transaction result could not be verified." };
      }
      const demandId = record.verification
        ? resolveUniqueCreatedDemandId(record.verification.before, boardRef.current, record.verification.expected)
        : null;
      if (activeWalletIdentityRef.current === record.wallet.toLowerCase()) setStatus(`${displayLabel} success`);
      return confirmedHash
        ? { kind: "confirmed", hash: confirmedHash, demandId, ...(record.verification ? { verification: record.verification } : {}) }
        : { kind: "failed", message: "The transaction hash was not available." };
    } catch (error) {
      if (error instanceof TransactionLifecycleError) {
        setLastTx(error.hash);
        setTransactionState(error.state);
        if (activeWalletIdentityRef.current === record.wallet.toLowerCase()) setStatus(`${displayLabel} ${error.stage} ${error.state}`);
        return transactionOutcomeFromError(error, record.actionId, record.verification);
      }
      const message = errorMessage(error);
      if (activeWalletIdentityRef.current === record.wallet.toLowerCase()) setStatus(message);
      return confirmedHash
        ? { kind: "readback-failed", hash: confirmedHash, message, ...(record.verification ? { verification: record.verification } : {}) }
        : { kind: "failed", message };
    } finally {
      activeActionLocksRef.current.delete(lockKey);
      setBusy(false);
    }
  }

  async function verifyCreate(outcome: CreateDemandTransactionOutcome): Promise<CreateDemandRunOutcome> {
    const record = pendingCreateRecord?.hash.toLowerCase() === outcome.hash.toLowerCase() ? pendingCreateRecord : null;
    if (!record) return { kind: "failed", message: "The saved create transaction is no longer available for this wallet." };
    return verifyPendingTransaction(record);
  }

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = workspaceRef.current?.querySelectorAll(".market-card");
    if (!cards?.length) return;
    const animation = animate(Array.from(cards).slice(0, 8), { opacity: [0.5, 1], translateY: [6, 0], duration: 280, delay: stagger(24), ease: "out(3)" });
    return () => { animation.revert(); };
  }, [location.pathname, boardLoading]);

  const routeIsDetail = location.pathname.startsWith(ROUTES.market.href + "/");
  const activeRoute = location.pathname === ROUTES.createDemand.href
    ? "create-demand"
    : location.pathname === ROUTES.analytics.href
      ? "analytics"
      : "market";
  const pageTitle = routeIsDetail
    ? "Demand Details"
    : activeRoute === "create-demand"
      ? "Create Demand"
      : activeRoute === "analytics"
        ? "Analytics"
        : "Explore Market";
  const visiblePendingTransactions = pendingTransactions.filter((record) =>
    !(activeRoute === "create-demand" && record.actionId === CREATE_DEMAND_ACTION_ID),
  );

  const outletContext: AppOutletContext = {
    board,
    boardLoading,
    boardLoadError,
    selectedId,
    account,
    support: currentSupport,
    supportState: currentSupportState,
    busy,
    lastTx,
    pendingCreate,
    blockedActionIds,
    run,
    verifyPendingTransaction,
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
        <div className={"legacy-content" + (activeRoute === "create-demand" ? " create-demand-content" : "") + (routeIsDetail ? " demand-detail-content" : "")}>
          <a className="skip-link" href="#workspace">{activeRoute === "create-demand" ? "Skip to Create Demand" : activeRoute === "analytics" ? "Skip to Analytics" : "Skip to Market Requests"}</a>
          <div className="status-stack">
            {account && !chainOk && <div className="status-line err">Wrong network · writes request X Layer {CHAIN_ID}.</div>}
            {transactionPersistence.warning && <div className="status-line err" role="alert">{transactionPersistence.warning}</div>}
            {visiblePendingTransactions.map((record) => (
              <div className="status-line" role={record.state === "unknown" ? "alert" : "status"} key={`${record.wallet}:${record.chainId}:${record.actionId}`}>
                <strong>{pendingActionLabel(record.actionLabel)} · {record.stage === "approval" ? "token approval" : "transaction"} {record.state === "broadcast" ? "submitted; receipt pending" : "status unknown"}</strong>
                <span>{record.stage === "approval"
                  ? "The approval is separate from the requested action. Verify it before starting the action again."
                  : "Do not submit this action again until this transaction is verified."}</span>
                <a href={explorerTx(record.hash)} target="_blank" rel="noreferrer"><code>{record.hash}</code></a>
                <button className="ghost" type="button" disabled={busy || !chainOk} onClick={() => void verifyPendingTransaction(record)}>Verify existing transaction</button>
              </div>
            ))}
            {supportError && !routeIsDetail && <div role="alert" aria-live="polite" className="status-line err">{supportError}</div>}
            {boardError && <div role="alert" aria-live="polite" className="status-line err">{boardError}</div>}
            {status && <div role="status" aria-live="polite" className={"status-line " + (status.includes("FAILED") ? "err" : status.includes("success") || status.includes("confirmed") ? "ok" : transactionState === "reverted" || transactionState === "cancelled" || transactionState === "unknown" ? "err" : status.includes("pending") || transactionState === "broadcast" ? "" : "err")}>{status}</div>}
            {lastTx && account?.toLowerCase() === lastTxWallet && <div className="status-line">tx <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer"><code>{lastTx}</code></a></div>}
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
      loading={boardLoading && board.length === 0}
      loadError={boardLoadError && board.length === 0}
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
      key={account?.toLowerCase() ?? "disconnected"}
      account={account}
      busy={busy}
      contractConfigured={Boolean(DEMAND_CONTRACT)}
      walletStatus={walletStatus}
      pendingTransaction={pendingCreate}
      onConnect={connect}
      onCreate={(input) => run("create", CREATE_DEMAND_ACTION_ID, (onUpdate) => createDemand(input, onUpdate), input)}
      onVerify={verifyCreate}
      onRefreshBoard={refreshBoard}
    />
  );
}

export function AnalyticsRoute() {
  const { board, boardLoading, boardLoadError } = useOutletContext<AppOutletContext>();
  return <AnalyticsDashboard board={board} loading={boardLoading} loadError={boardLoadError} contractConfigured={Boolean(DEMAND_CONTRACT)} />;
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
  const { board, boardLoading, boardLoadError, refreshBoard, account, support, supportState, busy, lastTx, run, blockedActionIds } = useOutletContext<AppOutletContext>();
  const demand = demandId === null ? undefined : board.find((candidate) => candidate.demandId === demandId);
  const detail: DemandDetailLoad = demandId === null
    ? { kind: "invalid" }
    : !DEMAND_CONTRACT
      ? { kind: "not-configured" }
      : demand
        ? { kind: "ready", demand }
        : boardLoading
          ? { kind: "loading" }
          : boardLoadError
            ? { kind: "error" }
            : { kind: "not-found" };
  const returnTo = demandReturnPath(location.state);
  const close = useCallback(() => navigate(returnTo), [navigate, returnTo]);

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
      <section className="panel demand-page demand-detail-state" aria-labelledby="demand-load-heading">
        <header className="demand-detail-header">
          <div className="demand-detail-heading-group">
            <p className="demand-detail-kicker">Market Request</p>
            <h1 id="demand-load-heading" className="demand-detail-heading" tabIndex={-1}>
              {detail.kind === "loading" ? "Loading Market Request" : "Market Request Unavailable"}
            </h1>
          </div>
          <Button type="button" variant="outline" className="demand-detail-action" onClick={close}>
            {returnTo === ROUTES.analytics.href ? "Back to Analytics" : "Back to Market Requests"}
          </Button>
        </header>
        <Card className="demand-detail-card">
          <CardContent className="demand-detail-state-content">
            {detail.kind === "loading" && (
              <div className="demand-detail-loading" aria-hidden="true">
                <Skeleton className="demand-detail-skeleton demand-detail-skeleton-title" />
                <Skeleton className="demand-detail-skeleton" />
                <Skeleton className="demand-detail-skeleton demand-detail-skeleton-short" />
              </div>
            )}
            <p className="demand-detail-state-message" role={detail.kind === "loading" ? "status" : "alert"}>{message}</p>
            {detail.kind === "error" && (
              <Button type="button" className="demand-detail-action" onClick={() => void refreshBoard()}>Retry</Button>
            )}
          </CardContent>
        </Card>
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
      closeLabel={returnTo === ROUTES.analytics.href ? "Back to Analytics" : "Back to Market Requests"}
      run={run}
      blockedActionIds={blockedActionIds}
    />
  );
}

function demandReturnPath(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) return ROUTES.market.href;
  return state.from === ROUTES.analytics.href || state.from === ROUTES.myActivity.href ? ROUTES.analytics.href : ROUTES.market.href;
}

function DemandBoard({ board, loading, loadError, selectedId, contractConfigured, detailFrom }: { board: DemandView[]; loading: boolean; loadError: boolean; selectedId: bigint | null; contractConfigured: boolean; detailFrom: string }) {
  const [search, setSearch] = useState("");
  const [activeStatus, setActiveStatus] = useState("ALL");
  const [sort, setSort] = useState<MarketSort>("most-funded");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { requests, statusCounts } = useMemo(
    () => deriveMarketRequests(board, { search, status: activeStatus, sort }, (demand) => effectiveStatus(demand, now)),
    [activeStatus, board, now, search, sort],
  );
  const statusOptions = [
    { value: "ALL", label: "All" },
    ...MARKET_STATUSES.map((value) => ({ value, label: value })),
    ...(statusCounts.has("UNKNOWN") || activeStatus === "UNKNOWN" ? [{ value: "UNKNOWN", label: "UNKNOWN" }] : []),
  ];
  const sortLabel = MARKET_SORTS.find((option) => option.value === sort)?.label ?? "Most Funded";

  return (
    <section className="panel market-panel">
      <div className="board-title market-heading">
        <div>
          <h1>What the market needs</h1>
          <p className="workflow-summary">Requests backed by real escrow.</p>
        </div>
        <span className="unit">USD₮0</span>
      </div>
      {loading ? (
        <div className="market-loading">
          <p role="status">Loading market requests…</p>
          <div className="market-skeleton-grid" aria-hidden="true">
            {[0, 1, 2].map((item) => (
              <Card className="market-skeleton-card" key={item}>
                <CardContent className="market-skeleton-content">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-7 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : !contractConfigured ? (
        <div className="market-state market-state-error" role="alert">Market data is unavailable because the demand contract is not configured.</div>
      ) : loadError ? (
        <div className="market-state market-state-error" role="alert">Could not load market requests. Use the refresh button to try again.</div>
      ) : board.length === 0 ? (
        <div className="market-state market-state-zero">No funded market requests yet.</div>
      ) : (
        <>
          <div className="market-toolbar">
            <div className="market-search">
              <label className="market-control-label" htmlFor="market-request-search">Search capabilities or ID</label>
              <InputGroup className="market-search-group">
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="market-request-search"
                  type="search"
                  aria-label="Search capabilities or ID"
                  placeholder="Search capabilities or ID"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="market-search-count">{requests.length} results</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <div className="market-sort-control">
              <span className="market-control-label" id="market-sort-label">Sort by</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="market-sort-trigger"
                    aria-label={`Sort requests. Current order: ${sortLabel}`}
                  />
                }>
                  <ArrowUpDown aria-hidden="true" />
                  <span>{sortLabel}</span>
                  <ChevronDown aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="market-sort-menu">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Sort requests</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={sort}
                      onValueChange={(value) => {
                        const selectedSort = MARKET_SORTS.find((option) => option.value === value);
                        if (selectedSort) setSort(selectedSort.value);
                      }}
                    >
                      {MARKET_SORTS.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Tabs
            className="market-tabs flex-col w-full"
            value={activeStatus}
            onValueChange={(value) => {
              if (statusOptions.some((option) => option.value === value)) setActiveStatus(value);
            }}
          >
            <TabsList variant="line" className="market-status-tabs" aria-label="Filter requests by status">
              {statusOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value} className="market-status-tab">
                  {option.label}
                  <Badge variant={activeStatus === option.value ? "primary-light" : "secondary"}>
                    {option.value === "ALL" ? board.length : statusCounts.get(option.value) ?? 0}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={activeStatus} className="market-results">
              <p className="market-result-summary">Showing {requests.length} of {board.length} requests</p>
              {requests.length === 0 ? (
                <Empty className="market-no-results">
                  <EmptyHeader>
                    <EmptyTitle>No matching requests</EmptyTitle>
                    <EmptyDescription>Try another search or status.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" type="button" onClick={() => { setSearch(""); setActiveStatus("ALL"); }}>
                      Clear filters
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <ul className="market-grid" aria-label="Market requests">
                  {requests.map((demand) => (
                    <DemandCard
                      key={demand.demandId.toString()}
                      demand={demand}
                      selected={selectedId === demand.demandId}
                      detailFrom={detailFrom}
                      now={now}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
}

function DemandCard({ demand, selected, detailFrom, now }: { demand: DemandView; selected: boolean; detailFrom: string; now: bigint }) {
  const [copyMessage, setCopyMessage] = useState("");
  const state = effectiveStatus(demand, now);
  const requestId = demand.demandId.toString();
  const capability = demand.capability.trim() ? demand.capability : "Capability not provided";
  const specification = demand.specification.trim() ? demand.specification : "No details provided.";
  const StatusIcon = state === "READY" || state === "FULFILLED"
    ? CircleCheck
    : state === "OPEN" || state === "SUBMITTED"
      ? Clock3
      : state === "EXPIRED" || state === "REJECTED" || state === "CLOSED"
        ? CircleX
        : CircleHelp;

  async function copyRequestLink() {
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyMessage("Clipboard access is unavailable.");
        return;
      }
      await navigator.clipboard.writeText(new URL(demandHref(demand.demandId), window.location.origin).toString());
      setCopyMessage("Request link copied.");
    } catch {
      setCopyMessage("Could not copy request link.");
    }
  }

  return (
    <li className="market-grid-item">
      <Card className="market-card" data-selected={selected || undefined}>
        <CardContent className="market-card-content">
          <div className="market-card-header">
            <Badge variant="secondary" className="market-status-badge" data-status={state}>
              <StatusIcon aria-hidden="true" />
              {state}
            </Badge>
            <span className="market-card-id">Request #{requestId}</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button variant="ghost" size="icon" className="market-card-menu-trigger" aria-label={`More actions for request #${requestId}`} />
              }>
                <MoreVertical aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="market-card-menu">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void copyRequestLink()}>Copy link</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="market-card-body">
            <div className="market-card-title-row">
              <h2 className="market-card-title">{capability}</h2>
            </div>
            <p className="market-card-description">{specification}</p>
            <div className="market-card-escrow">
              <span className="market-card-metric-label">Escrow</span>
              <p><strong>{formatUsd0(demand.committed)}</strong><span>USD₮0</span></p>
            </div>
            <dl className="market-card-metrics">
              <div>
                <dt>Wallets</dt>
                <dd>
                  <AvatarGroup role="img" aria-label={`${demand.supporterCount.toLocaleString("en-US")} wallets`}>
                    <AvatarGroupCount className="market-wallet-count" aria-hidden="true">{demand.supporterCount.toLocaleString("en-US")}</AvatarGroupCount>
                  </AvatarGroup>
                </dd>
              </div>
              <div>
                <dt>Expected calls</dt>
                <dd>{demand.expectedCalls.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Max / call</dt>
                <dd>{formatUsd0(demand.maxUnitPrice)} <small>USD₮0</small></dd>
              </div>
            </dl>
          </div>
          <div className="market-card-footer">
            <Button
              variant="outline"
              className="market-view-request"
              render={<Link to={demandHref(demand.demandId)} state={{ from: detailFrom }} aria-label={`View request #${requestId}: ${capability}`} />}
              nativeButton={false}
            >
              View Request
            </Button>
          </div>
          <span className="sr-only" role="status">{copyMessage}</span>
        </CardContent>
      </Card>
    </li>
  );
}

function DemandDetail({
  demand, support, supportState, account, busy, close, closeLabel, run, blockedActionIds,
}: {
  demand: DemandView;
  support: SupportView;
  supportState: "loading" | "ready" | "error";
  account: Address | null;
  busy: boolean;
  close: () => void;
  closeLabel: string;
  run: RunHandler;
  blockedActionIds: string[];
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [activeView, setActiveView] = useState<"overview" | "fund" | "build-review">("overview");
  const [supportAmount, setSupportAmount] = useState("0.05");
  const [supportCalls, setSupportCalls] = useState("1000");
  const [serviceUrl, setServiceUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLHeadingElement>("h1")?.focus({ preventScroll: true });
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
  const actionBlocked = (action: string) => blockedActionIds.includes(`${action}:${demand.demandId.toString()}`);

  return (
    <section ref={panelRef} className="panel demand-page" aria-labelledby="demand-detail-heading">
      <header className="demand-detail-header">
        <div className="demand-detail-heading-group">
          <p className="demand-detail-kicker">Market Request #{demand.demandId.toString()}</p>
          <h1 id="demand-detail-heading" className="demand-detail-heading" tabIndex={-1}>{demand.capability}</h1>
          <p className="demand-detail-summary">A market need backed by real escrow.</p>
        </div>
        <div className="demand-detail-header-actions">
          <Badge className="market-status-badge demand-detail-status" data-status={state} variant="secondary" size="lg">{state}</Badge>
          <Button type="button" variant="outline" className="demand-detail-action" onClick={close}>{closeLabel}</Button>
        </div>
      </header>

      <Tabs
        value={activeView}
        onValueChange={(next) => {
          if (next === "overview" || next === "fund" || next === "build-review") setActiveView(next);
        }}
        className="demand-detail-tabs"
      >
        <TabsList variant="line" aria-label="Market Request sections">
          <TabsTrigger value="overview">Request Details</TabsTrigger>
          <TabsTrigger value="fund">Escrow &amp; Support</TabsTrigger>
          <TabsTrigger value="build-review">Builder Proposal</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="demand-detail-tab-panel">
          <div className="demand-detail-content-grid">
            <Card className="demand-detail-card">
              <CardHeader className="demand-detail-card-header">
                <CardTitle className="demand-detail-section-title">What is needed</CardTitle>
                <CardDescription className="demand-detail-card-description">Details provided by the request creator.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="demand-detail-facts">
                  <div><dt>Capability</dt><dd>{demand.capability}</dd></div>
                  <div><dt>Specification</dt><dd>{demand.specification}</dd></div>
                  <div><dt>Creator</dt><dd>{demand.creator}</dd></div>
                  <div><dt>Deadline</dt><dd>{iso(demand.deadline)}</dd></div>
                </dl>
              </CardContent>
            </Card>
            <Card className="demand-detail-card">
              <CardHeader className="demand-detail-card-header">
                <CardTitle className="demand-detail-section-title">Market backing</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="demand-detail-facts">
                  <div className="demand-detail-escrow"><dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} <span>USD₮0</span></dd></div>
                  <div><dt>Supporting wallets</dt><dd>{demand.supporterCount}</dd></div>
                  <div><dt>Expected calls</dt><dd>{demand.expectedCalls.toString()}</dd></div>
                  <div><dt>Max unit price</dt><dd>{formatUsd0(demand.maxUnitPrice)} <span>USD₮0</span></dd></div>
                  <div><dt>Status</dt><dd><Badge className="market-status-badge demand-detail-status" data-status={state} variant="secondary" size="lg">{state}</Badge></dd></div>
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="fund" className="demand-detail-tab-panel">
          <div className="demand-detail-content-grid">
            <Card className="demand-detail-card">
              <CardHeader className="demand-detail-card-header">
                <CardTitle className="demand-detail-section-title">Market backing</CardTitle>
                <CardDescription className="demand-detail-card-description">Current escrow and wallet-specific support.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="demand-detail-facts">
                  <div className="demand-detail-escrow"><dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} <span>USD₮0</span></dd></div>
                  <div><dt>Supporting wallets</dt><dd>{demand.supporterCount}</dd></div>
                  <div><dt>Your commitment</dt><dd>{account ? <>{formatUsd0(support.commitment)} <span>USD₮0</span></> : "connect wallet"}</dd></div>
                  {account && supportState === "loading" && <div><dt>Wallet position</dt><dd role="status">Loading your onchain position…</dd></div>}
                  {account && supportState === "error" && <div><dt>Wallet position</dt><dd role="alert">Could not read your position. Refresh the chain view before voting or refunding.</dd></div>}
                </dl>
              </CardContent>
            </Card>
            {state === "OPEN" && (
              <Card className="demand-detail-card">
                <CardHeader className="demand-detail-card-header">
                  <CardTitle className="demand-detail-section-title">Support this request</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="demand-detail-form">
                    <label htmlFor="demand-support-amount">Amount (USD₮0)
                      <Input id="demand-support-amount" value={supportAmount} onChange={(event) => setSupportAmount(event.currentTarget.value)} className="demand-detail-input" />
                    </label>
                    <label htmlFor="demand-support-calls">Expected calls
                      <Input id="demand-support-calls" value={supportCalls} onChange={(event) => setSupportCalls(event.currentTarget.value)} className="demand-detail-input" />
                    </label>
                    <Button type="button" className="demand-detail-action" disabled={busy || !account || actionBlocked("support")} onClick={() => void run("support", `support:${demand.demandId}`, (onUpdate) => supportDemand(demand.demandId, supportAmount, supportCalls, onUpdate))}>Support This Request</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {supportState === "ready" && support.refundable && (
              <Card className="demand-detail-card">
                <CardHeader className="demand-detail-card-header">
                  <CardTitle className="demand-detail-section-title">Refund</CardTitle>
                  <CardDescription className="demand-detail-card-description">Your eligible commitment can be returned.</CardDescription>
                </CardHeader>
                <CardContent className="demand-detail-actions">
                  <Button type="button" variant="destructive" className="demand-detail-action" disabled={busy || !account || actionBlocked("refund")} onClick={() => void run("refund", `refund:${demand.demandId}`, (onUpdate) => refundDemand(demand.demandId, onUpdate))}>Refund {formatUsd0(support.commitment)} USD₮0</Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="build-review" className="demand-detail-tab-panel">
          <div className="demand-detail-content-grid">
            <Card className="demand-detail-card">
              <CardHeader className="demand-detail-card-header">
                <CardTitle className="demand-detail-section-title">Builder Proposal</CardTitle>
                {!hasProposal && state === "OPEN" && <CardDescription className="demand-detail-card-description">Built a solution? Submit the service here.</CardDescription>}
              </CardHeader>
              {hasProposal ? (
                <CardContent>
                  <dl className="demand-detail-facts">
                    <div><dt>Builder</dt><dd>{demand.builder}</dd></div>
                    <div><dt>Service URL</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{safeUrl}</a> : demand.serviceUrl}</dd></div>
                    <div><dt>Evidence</dt><dd>{demand.evidenceHash}</dd></div>
                  </dl>
                </CardContent>
              ) : state === "OPEN" ? (
                <CardContent>
                  <div className="demand-detail-form">
                    <label htmlFor="proposal-service-url">Service URL
                      <Input id="proposal-service-url" value={serviceUrl} onChange={(event) => setServiceUrl(event.currentTarget.value)} placeholder="https://service.example/api" className="demand-detail-input" />
                    </label>
                    <label htmlFor="proposal-evidence">Evidence</label>
                    <Textarea id="proposal-evidence" aria-describedby="proposal-evidence-help" value={evidence} onChange={(event) => setEvidence(event.currentTarget.value)} className="demand-detail-input" />
                    <p className="demand-detail-help" id="proposal-evidence-help">Proof that the service fulfills this request.</p>
                    <Button type="button" className="demand-detail-action" disabled={busy || !account || actionBlocked("submit")} onClick={() => void run("submit", `submit:${demand.demandId}`, (onUpdate) => submitService(demand.demandId, serviceUrl, evidence, onUpdate))}>Submit Service Proposal</Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
            {demand.status === 1 && (
              <Card className="demand-detail-card">
                <CardHeader className="demand-detail-card-header">
                  <CardTitle className="demand-detail-section-title">Review</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="demand-detail-facts">
                    <div><dt>Review snapshot</dt><dd>{formatUsd0(demand.reviewCommitted)} <span>USD₮0</span></dd></div>
                    <div><dt>Review end</dt><dd>{demand.reviewEndsAt === 0n ? "—" : iso(demand.reviewEndsAt)}</dd></div>
                    <div><dt>Approval progress</dt><dd>
                      {formatUsd0(demand.approvalWeight)} / {formatUsd0(demand.approvalRequired)} <span>USD₮0</span>
                      <div className="demand-detail-progress" role="progressbar" aria-label="Approval progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: percent + "%" }} /></div>
                      <span className="demand-detail-muted">Only approver funds settle.</span>
                    </dd></div>
                    <div><dt>Rejection progress</dt><dd>
                      {formatUsd0(demand.rejectionWeight)} / {formatUsd0(demand.rejectionThreshold)} <span>USD₮0</span>
                      <div className="demand-detail-progress rejection" role="progressbar" aria-label="Rejection progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rejectionPercent}><span style={{ width: rejectionPercent + "%" }} /></div>
                    </dd></div>
                  </dl>
                  <div className="demand-detail-actions">
                    {!reviewExpired && supportState === "ready" && support.commitment > 0n && !support.approved && !support.rejected && (
                      <>
                        <Button type="button" className="demand-detail-action" disabled={busy || !account || actionBlocked("approve")} onClick={() => void run("approve", `approve:${demand.demandId}`, (onUpdate) => approveService(demand.demandId, onUpdate))}>Approve Proposal</Button>
                        <Button type="button" variant="destructive" className="demand-detail-action" disabled={busy || !account || actionBlocked("reject")} onClick={() => void run("reject", `reject:${demand.demandId}`, (onUpdate) => rejectService(demand.demandId, onUpdate))}>Reject Proposal</Button>
                      </>
                    )}
                    {supportState === "ready" && support.approved && <span className="status-line ok">Approved · commitment eligible for settlement.</span>}
                    {supportState === "ready" && support.rejected && <span className="status-line err">Proposal rejected.</span>}
                  </div>
                </CardContent>
              </Card>
            )}
            {(demand.status === 1 && demand.quorumReached || canReopen) && (
              <Card className="demand-detail-card">
                <CardHeader className="demand-detail-card-header">
                  <CardTitle className="demand-detail-section-title">Settlement</CardTitle>
                </CardHeader>
                <CardContent className="demand-detail-actions">
                  {demand.status === 1 && demand.quorumReached && (
                    <Button type="button" className="demand-detail-action" disabled={busy || actionBlocked("finalize")} onClick={() => void run("finalize", `finalize:${demand.demandId}`, (onUpdate) => finalizeDemand(demand.demandId, onUpdate))}>Finalize Payout</Button>
                  )}
                  {canReopen && (
                    <Button type="button" variant="outline" className="demand-detail-action" disabled={busy || !account || actionBlocked("reopen")} onClick={() => void run("reopen", `reopen:${demand.demandId}`, (onUpdate) => reopenDemand(demand.demandId, onUpdate))}>Reopen Demand</Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
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
