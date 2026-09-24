import { animate, stagger } from "animejs";
import "@fontsource-variable/figtree";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { getAddress, isAddress, type Address, type Hash } from "viem";
import type { AppKit } from "@reown/appkit/react";
import {
  CHAIN_ID,
  DEMAND_CONTRACT,
  approveService,
  connectWallet,
  createDemand,
  currentChainId,
  currentWallet,
  effectiveStatus,
  explorerTx,
  finalizeDemand,
  formatUsd0,
  readBoard,
  readSupport,
  refundDemand,
  rejectService,
  reopenDemand,
  statusName,
  submitService,
  supportDemand,
  setWalletProvider,
  watchWallet,
  type DemandView,
  type SupportView,
} from "./contract.ts";

const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();
const NetworkBackground = lazy(() => import("./NetworkBackground.tsx"));
const EMPTY_SUPPORT: SupportView = { commitment: 0n, expectedCalls: 0n, approved: false, rejected: false, refundable: false };

type Tab = "board" | "create" | "activity";

export default function App() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [board, setBoard] = useState<DemandView[]>([]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardLoadError, setBoardLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [demandOpen, setDemandOpen] = useState(false);
  const [walletKit, setWalletKit] = useState<AppKit | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [support, setSupport] = useState<SupportView>(EMPTY_SUPPORT);
  const [supportKey, setSupportKey] = useState("");
  const [supportState, setSupportState] = useState<"loading" | "ready" | "error">("ready");
  const [mySupportIds, setMySupportIds] = useState<Set<string>>(new Set());
  const [activityState, setActivityState] = useState<"loading" | "ready" | "error">("ready");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastTx, setLastTx] = useState<Hash | null>(null);

  const selected = useMemo(
    () => selectedId === null ? null : board.find((d) => d.demandId === selectedId) ?? null,
    [board, selectedId],
  );
  const supportIdentity = account && selectedId !== null ? `${account.toLowerCase()}:${selectedId}` : "";
  const currentSupport = supportIdentity !== "" && supportKey === supportIdentity ? support : EMPTY_SUPPORT;
  const currentSupportState = supportIdentity === "" ? "ready" : supportKey === supportIdentity ? supportState : "loading";

  const refresh = useCallback(async (): Promise<boolean> => {
    setBoardLoading(true);
    setBoardLoadError(false);
    try {
      const latestBoard = await readBoard();
      setBoard(latestBoard);
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      setBoardLoadError(true);
      return false;
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const syncWallet = useCallback(async (kit: AppKit | null = walletKit) => {
    if (kit) {
      const wallet = kit.getAccount("eip155");
      const address = wallet?.address;
      setAccount(wallet?.isConnected && address && isAddress(address) ? getAddress(address) : null);
      const chain = kit.getChainId();
      setChainOk(chain === undefined || Number(chain) === CHAIN_ID);
      setWalletProvider(kit.getWalletProvider());
      return;
    }
    try {
      const [wallet, chain] = await Promise.all([currentWallet(), currentChainId()]);
      setAccount(wallet);
      setChainOk(chain === null || chain === CHAIN_ID);
    } catch {
      setAccount(null);
      setChainOk(false);
    }
  }, [walletKit]);

  useEffect(() => {
    void refresh();
    void syncWallet();
    const kit = walletKit;
    if (kit) {
      const stopAccount = kit.subscribeAccount(() => void syncWallet(), "eip155");
      const stopNetwork = kit.subscribeNetwork(() => void syncWallet());
      const stopProvider = kit.subscribeProviders(() => setWalletProvider(kit.getWalletProvider()));
      return () => {
        stopAccount();
        stopNetwork();
        stopProvider();
        setWalletProvider(null);
      };
    }
    return watchWallet(() => void syncWallet());
  }, [refresh, syncWallet, walletKit]);

  useEffect(() => {
    if (!account || selectedId === null) {
      setSupport(EMPTY_SUPPORT);
      setSupportKey("");
      setSupportState("ready");
      return;
    }
    let live = true;
    const key = `${account.toLowerCase()}:${selectedId}`;
    setSupport(EMPTY_SUPPORT);
    setSupportKey(key);
    setSupportState("loading");
    void readSupport(selectedId, account)
      .then((value) => { if (live) { setSupport(value); setSupportState("ready"); } })
      .catch((error: unknown) => {
        if (live) {
          setSupport(EMPTY_SUPPORT);
          setSupportState("error");
          setStatus(errorMessage(error));
        }
      });
    return () => { live = false; };
  }, [account, selectedId, board]);

  useEffect(() => {
    if (!account) {
      setMySupportIds(new Set());
      setActivityState("ready");
      return;
    }
    if (boardLoading) {
      setActivityState("loading");
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
    void Promise.all(board.map(async (d) => {
      const own = await readSupport(d.demandId, account);
      return own.commitment > 0n ? d.demandId.toString() : null;
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
  }, [account, board, boardLoading]);

  async function connect() {
    if (reownProjectId) {
      setBusy(true);
      setStatus("");
      try {
        const { appKit: kit } = await import("./reown.ts");
        if (!kit) throw new Error("REOWN_NOT_CONFIGURED");
        setWalletKit(kit);
        await syncWallet(kit);
        await kit.open({ view: kit.getAccount("eip155")?.isConnected ? "Account" : "Connect", namespace: "eip155" });
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const address = await connectWallet();
      setAccount(address);
      await syncWallet();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function run(label: string, fn: () => Promise<Hash>) {
    setBusy(true);
    if (account && selectedId !== null) setSupportState("loading");
    setStatus(`${label} pending`);
    setLastTx(null);
    try {
      const hash = await fn();
      setLastTx(hash);
      const readbackComplete = await refresh();
      await syncWallet();
      if (!readbackComplete) {
        setStatus("CHAIN_STATE_READBACK_FAILED");
        return;
      }
      setStatus(`${label} success`);
    } catch (error) {
      setStatus(errorMessage(error));
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
  }, [tab, boardLoading]);

  function closeDetail() {
    const trigger = document.querySelector<HTMLButtonElement>(".selected .capability button, .selected .activity-demand");
    setDemandOpen(false);
    setSelectedId(null);
    requestAnimationFrame(() => trigger?.focus());
  }

  function openDemand(id: bigint) {
    setSelectedId(id);
    setDemandOpen(true);
  }

  function navigate(next: Tab) {
    setDemandOpen(false);
    setSelectedId(null);
    setTab(next);
  }

  const activity = account
    ? board.filter((d) => d.creator.toLowerCase() === account.toLowerCase()
      || d.builder.toLowerCase() === account.toLowerCase()
      || mySupportIds.has(d.demandId.toString()))
    : [];

  return (
    <>
      <Suspense fallback={null}><NetworkBackground /></Suspense>
      <a className="skip-link" href="#workspace">Skip to market</a>
      <div className="app-shell">
        <aside className="nav-rail" aria-label="UNMET workspace">
          <a className="rail-brand" href="#workspace" onClick={() => navigate("board")} aria-label="UNMET home">
            <span className="brand-mark" aria-hidden="true" />
            <span>UNMET</span>
          </a>
          <nav className="rail-nav" aria-label="Workspace">
            <button aria-current={tab === "board" ? "page" : undefined} className={`nav-item ${tab === "board" ? "active" : ""}`} onClick={() => navigate("board")}>
              <NavGlyph tab="board" /><span>Demand board</span>
            </button>
            <button aria-current={tab === "create" ? "page" : undefined} className={`nav-item ${tab === "create" ? "active" : ""}`} onClick={() => navigate("create")}>
              <NavGlyph tab="create" /><span>Create demand</span>
            </button>
            <button aria-current={tab === "activity" ? "page" : undefined} className={`nav-item ${tab === "activity" ? "active" : ""}`} onClick={() => navigate("activity")}>
              <NavGlyph tab="activity" /><span>My Activity</span>
            </button>
          </nav>
          <div className="rail-note"><span className="signal-dot" />Demand market</div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="network"><span className="signal-dot" />X Layer <strong>{CHAIN_ID}</strong></div>
            <div className="topbar-actions">
              <button className="refresh" aria-label={boardLoading ? "Updating demand data" : "Refresh demand data"} onClick={() => { if (account && selectedId !== null) setSupportState("loading"); void refresh(); }} disabled={busy || boardLoading}>{boardLoading ? "Updating" : "Refresh"}</button>
              <div className="wallet-box">
                <button className="wallet-connect" disabled={busy} onClick={() => void connect()} aria-haspopup={reownProjectId ? "dialog" : undefined}>
                  <span className="wallet-connect-mark" aria-hidden="true" />
                  {account ? short(account) : "Connect wallet"}
                  {reownProjectId && <span className="wallet-connect-chevron" aria-hidden="true">⌄</span>}
                </button>
              </div>
            </div>
          </header>

          <div className="status-stack">
            {!DEMAND_CONTRACT && <div className="status-line err">Contract not configured.</div>}
            {account && !chainOk && <div className="status-line err">Wrong network · writes request X Layer {CHAIN_ID}.</div>}
            {status && <div role="status" aria-live="polite" className={`status-line ${status.includes("success") ? "ok" : status.includes("pending") ? "" : "err"}`}>{status}</div>}
            {lastTx && <div className="status-line">tx <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer"><code>{lastTx}</code></a></div>}
          </div>

          <main id="workspace" ref={workspaceRef} className="workspace">
            <div className="market-main" hidden={demandOpen}>
              {tab === "board" && <DemandBoard board={board} loading={boardLoading} loadError={boardLoadError} selectedId={selectedId} onSelect={openDemand} />}
              {tab === "create" && <CreatePanel busy={busy} run={run} />}
              {tab === "activity" && (
                <section className="panel activity-panel">
                  <div className="board-title"><h1>My Activity</h1>{account && <span className="unit">{activity.length} positions</span>}</div>
                  {!account ? <div className="empty">Connect a wallet to see your activity.</div>
                    : activityState === "loading" ? <div className="empty" role="status">Loading wallet activity…</div>
                    : activityState === "error" ? <div className="empty" role="alert">Could not read wallet activity. Refresh the chain view to retry.</div>
                    : activity.length === 0 ? <div className="empty">No onchain activity for this wallet.</div>
                    : <ActivityLedger board={activity} account={account} selectedId={selectedId} onSelect={openDemand} />}
                </section>
              )}
            </div>
            {demandOpen && selected && (
              <DemandDetail
                demand={selected}
                support={currentSupport}
                supportState={currentSupportState}
                account={account}
                busy={busy}
                close={closeDetail}
                closeLabel={tab === "activity" ? "Back to My Activity" : "Back to Demand board"}
                run={run}
              />
            )}
            {demandOpen && !selected && (
              <section className="panel detail demand-page" aria-label="Demand detail">
                <div className="detail-title"><h2>Demand unavailable</h2><button className="ghost" onClick={closeDetail}>Back to {tab === "activity" ? "My Activity" : "Demand board"}</button></div>
                <p className="empty">This demand is no longer in the current chain view. Refresh to try again.</p>
              </section>
            )}
          </main>

          <footer className="app-footer">
            <span>AgentDemand</span>
            <code>{DEMAND_CONTRACT ? short(DEMAND_CONTRACT) : "not configured"}</code>
          </footer>
        </div>
      </div>
    </>
  );
}

function NavGlyph({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    board: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>,
    create: <><path d="M12 4v16M4 12h16" /></>,
    activity: <><path d="M3 12h4l2.3-5 4.2 10 2.5-5H21" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[tab]}</svg>;
}

function DemandBoard({ board, loading, loadError, selectedId, onSelect }: { board: DemandView[]; loading: boolean; loadError: boolean; selectedId: bigint | null; onSelect: (id: bigint) => void }) {
  return (
    <section className="panel">
      <div className="board-title"><h1>Funded demand<span className="count">{loading || loadError ? "—" : board.length}</span></h1><span className="unit">USD₮0</span></div>
      {loading ? <div className="empty" role="status">Reading demand market…</div>
        : loadError ? <div className="empty error" role="alert">Demand read failed. Refresh chain to retry.</div>
        : board.length === 0 ? <div className="empty">No funded demand yet.</div>
        : <DemandTable board={board} selectedId={selectedId} onSelect={onSelect} />}
    </section>
  );
}

function DemandTable({ board, selectedId, onSelect }: { board: DemandView[]; selectedId: bigint | null; onSelect: (id: bigint) => void }) {
  return <table className="demand-table">
    <thead><tr><th>Capability</th><th>Committed</th><th>Expected calls</th><th>Wallets</th><th>Max / call</th><th>Status</th></tr></thead>
    <tbody>{board.map((demand) => <DemandCard key={demand.demandId.toString()} demand={demand} selected={selectedId === demand.demandId} onSelect={onSelect} />)}</tbody>
  </table>;
}

function ActivityLedger({ board, account, selectedId, onSelect }: { board: DemandView[]; account: Address; selectedId: bigint | null; onSelect: (id: bigint) => void }) {
  const entries = [...board].sort((a, b) => a.demandId > b.demandId ? -1 : a.demandId < b.demandId ? 1 : 0);
  return <ol className="activity-ledger">
    {entries.map((demand) => {
      const roles = [
        demand.creator.toLowerCase() === account.toLowerCase() ? "Creator" : "",
        demand.builder.toLowerCase() === account.toLowerCase() ? "Builder" : "",
      ].filter(Boolean);
      return <li className={`activity-entry ${selectedId === demand.demandId ? "selected" : ""}`} key={demand.demandId.toString()}>
        <span className="activity-role">{roles.length ? roles.join(" · ") : "Supporter"}</span>
        <button className="activity-demand" onClick={() => onSelect(demand.demandId)}><span className="demand-id">#{demand.demandId.toString().padStart(3, "0")}</span><strong>{demand.capability}</strong></button>
        <span className="activity-amount"><small>Escrow</small>{formatUsd0(demand.committed)} USD₮0</span>
        <span className={`badge ${effectiveStatus(demand)}`}>{effectiveStatus(demand)}</span>
      </li>;
    })}
  </ol>;
}

function DemandCard({ demand, selected, onSelect }: { demand: DemandView; selected: boolean; onSelect: (id: bigint) => void }) {
  const state = effectiveStatus(demand);
  return (
    <tr className={`demand-row ${selected ? "selected" : ""}`}>
      <td className="capability"><button aria-expanded={selected} onClick={() => onSelect(demand.demandId)}><span className="demand-id">#{demand.demandId.toString().padStart(3, "0")}</span><strong>{demand.capability}</strong><span className="row-open" aria-hidden="true">View</span></button></td>
      <td data-label="Committed" className="number">{formatUsd0(demand.committed)}</td>
      <td data-label="Expected calls" className="number">{demand.expectedCalls.toLocaleString("en-US")}</td>
      <td data-label="Wallets" className="number">{demand.supporterCount}</td>
      <td data-label="Max / call" className="number">{formatUsd0(demand.maxUnitPrice)}</td>
      <td data-label="Status"><span className={`badge ${state}`}>{state}</span></td>
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
  run: (label: string, fn: () => Promise<Hash>) => Promise<void>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeView, setActiveView] = useState<"overview" | "fund" | "build-review">("overview");
  const [supportAmount, setSupportAmount] = useState("0.05");
  const [supportCalls, setSupportCalls] = useState("1000");
  const [serviceUrl, setServiceUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const views = [
    { id: "overview", label: "Overview" },
    { id: "fund", label: "Fund" },
    { id: "build-review", label: "Build & Review" },
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
    <section ref={panelRef} className="panel detail demand-page" aria-label="Demand detail">
      <div className="detail-title">
        <h2 tabIndex={-1}><span className="demand-id">Demand #{demand.demandId.toString()}</span>{demand.capability}</h2>
        <button className="ghost" onClick={close}>{closeLabel}</button>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Demand views">
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
          <dl><dt>Status</dt><dd>{state}</dd></dl>
          <section className="action-block" aria-labelledby="request-heading">
            <h3 id="request-heading">Request</h3>
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
            </dl>
          </section>
        </div>
        <div id="demand-panel-fund" className="demand-tab-panel" role="tabpanel" aria-labelledby="demand-tab-fund" tabIndex={0} hidden={activeView !== "fund"}>
          <section className="action-block" aria-labelledby="escrow-heading">
            <h3 id="escrow-heading">Escrow</h3>
            <dl>
              <dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} USD₮0</dd>
              <dt>Your commitment</dt><dd>{account ? `${formatUsd0(support.commitment)} USD₮0` : "connect wallet"}</dd>
              {account && supportState === "loading" && <><dt>Wallet position</dt><dd role="status">Loading your onchain position…</dd></>}
              {account && supportState === "error" && <><dt>Wallet position</dt><dd role="alert">Could not read your position. Refresh the chain view before voting or refunding.</dd></>}
            </dl>
            {state === "OPEN" && (
              <div className="action-block">
                <label>Amount (USD₮0)<input value={supportAmount} onChange={(e) => setSupportAmount(e.target.value)} placeholder="USD₮0" /></label>
                <label>Expected calls<input value={supportCalls} onChange={(e) => setSupportCalls(e.target.value)} placeholder="Expected calls" /></label>
                <button className="primary" disabled={busy || !account} onClick={() => void run("support", () => supportDemand(demand.demandId, supportAmount, supportCalls))}>Commit to Escrow</button>
              </div>
            )}
            {supportState === "ready" && support.refundable && (
              <div className="actions"><button className="danger" disabled={busy || !account} onClick={() => void run("refund", () => refundDemand(demand.demandId))}>Refund {formatUsd0(support.commitment)} USD₮0</button></div>
            )}
          </section>
        </div>
        <div id="demand-panel-build-review" className="demand-tab-panel" role="tabpanel" aria-labelledby="demand-tab-build-review" tabIndex={0} hidden={activeView !== "build-review"}>
          <section className="action-block" aria-labelledby="proposal-heading">
            <h3 id="proposal-heading">Proposal</h3>
            <dl>
              <dt>Builder</dt><dd>{demand.builder}</dd>
              <dt>Service URL</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{safeUrl}</a> : demand.serviceUrl || "—"}</dd>
              <dt>Evidence</dt><dd>{demand.evidenceHash}</dd>
            </dl>
            {state === "OPEN" && (
              <div className="action-block">
                <label>Service URL<input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://service.example/api" /></label>
                <label>Evidence<textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence JSON/text or 0x bytes32 hash" /></label>
                <button className="primary" disabled={busy || !account} onClick={() => void run("submit", () => submitService(demand.demandId, serviceUrl, evidence))}>Submit Proposal</button>
              </div>
            )}
          </section>
          {demand.status === 1 && (
            <section className="action-block" aria-labelledby="review-heading">
              <h3 id="review-heading">Review</h3>
              <dl>
                <dt>Review snapshot</dt><dd>{formatUsd0(demand.reviewCommitted)} USD₮0</dd>
                <dt>Review ends</dt><dd>{demand.reviewEndsAt === 0n ? "—" : iso(demand.reviewEndsAt)}</dd>
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
                    <button className="primary" disabled={busy || !account} onClick={() => void run("approve", () => approveService(demand.demandId))}>Approve Proposal</button>
                    <button className="danger" disabled={busy || !account} onClick={() => void run("reject", () => rejectService(demand.demandId))}>Reject Proposal</button>
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
                  <button className="primary" disabled={busy} onClick={() => void run("finalize", () => finalizeDemand(demand.demandId))}>Finalize Payout</button>
                )}
                {canReopen && (
                  <button className="ghost" disabled={busy || !account} onClick={() => void run("reopen", () => reopenDemand(demand.demandId))}>Reopen Demand</button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

function CreatePanel({ busy, run }: {
  busy: boolean;
  run: (label: string, fn: () => Promise<Hash>) => Promise<void>;
}) {
  const [capability, setCapability] = useState("vendor-kyb-singapore");
  const [specification, setSpecification] = useState("legal entity status + ownership data + source URLs + JSON");
  const [maxPrice, setMaxPrice] = useState("0.02");
  const [expectedCalls, setExpectedCalls] = useState("25000");
  const [deadlineDays, setDeadlineDays] = useState("14");
  const [commitment, setCommitment] = useState("0.05");

  return (
    <section className="panel create-panel">
      <h1>Create demand</h1>
      <form className="create-form" onSubmit={(event) => {
        event.preventDefault();
        void run("create", () => createDemand({ capability, specification, maxPrice, expectedCalls, deadlineDays, commitment }));
      }}>
        <section className="create-core" aria-labelledby="create-request-heading">
          <h2 id="create-request-heading" className="form-section-heading">Request</h2>
          <label>Capability<input value={capability} onChange={(e) => setCapability(e.target.value)} maxLength={64} required /></label>
          <label>Specification<textarea value={specification} onChange={(e) => setSpecification(e.target.value)} maxLength={2048} required /></label>
          <label>Deadline (days from now)<input inputMode="decimal" value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} required /></label>
        </section>
        <div className="create-core">
          <section className="create-terms" aria-labelledby="create-economics-heading">
            <h2 id="create-economics-heading" className="form-section-heading">Economics</h2>
            <label>Max unit price (USD₮0)<input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} required /></label>
            <label>Expected calls<input inputMode="numeric" value={expectedCalls} onChange={(e) => setExpectedCalls(e.target.value)} required /></label>
          </section>
          <section className="create-core" aria-labelledby="create-escrow-heading">
            <h2 id="create-escrow-heading" className="form-section-heading">Initial Escrow</h2>
            <label>Initial commitment (USD₮0)<input inputMode="decimal" value={commitment} onChange={(e) => setCommitment(e.target.value)} required /></label>
          </section>
        </div>
        <div className="create-submit"><button className="primary" disabled={busy} type="submit">Create Demand &amp; Commit Escrow</button></div>
      </form>
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
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "INTERNAL_ERROR";
  const known = error.message.match(/(WALLET_[A-Z_]+|CHAIN_[A-Z_]+|DEMAND_[A-Z_]+|SUPPORT_[A-Z_]+|SUBMISSION_[A-Z_]+)/)?.[1];
  if (known === "DEMAND_INVALID_CAPABILITY") return "Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max).";
  return known ?? error.message.slice(0, 180);
}
