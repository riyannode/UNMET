import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hash } from "viem";
import {
  CHAIN_ID,
  DEMAND_CONTRACT,
  PAYMENT_TOKEN,
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
  watchWallet,
  type DemandView,
  type SupportView,
} from "./contract.ts";

const EMPTY_SUPPORT: SupportView = { commitment: 0n, expectedCalls: 0n, approved: false, rejected: false, refundable: false };

type Tab = "board" | "create" | "activity";

export default function App() {
  const [tab, setTab] = useState<Tab>("board");
  const [board, setBoard] = useState<DemandView[]>([]);
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [support, setSupport] = useState<SupportView>(EMPTY_SUPPORT);
  const [mySupportIds, setMySupportIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastTx, setLastTx] = useState<Hash | null>(null);

  const selected = useMemo(
    () => selectedId === null ? null : board.find((d) => d.demandId === selectedId) ?? null,
    [board, selectedId],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const latestBoard = await readBoard();
      setBoard(latestBoard);
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      return false;
    }
  }, []);

  const syncWallet = useCallback(async () => {
    try {
      const [wallet, chain] = await Promise.all([currentWallet(), currentChainId()]);
      setAccount(wallet);
      setChainOk(chain === null || chain === CHAIN_ID);
    } catch {
      setAccount(null);
      setChainOk(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void syncWallet();
    return watchWallet(() => void syncWallet());
  }, [refresh, syncWallet]);

  useEffect(() => {
    if (!account || selectedId === null) {
      setSupport(EMPTY_SUPPORT);
      return;
    }
    let live = true;
    void readSupport(selectedId, account)
      .then((value) => { if (live) setSupport(value); })
      .catch(() => { if (live) setSupport(EMPTY_SUPPORT); });
    return () => { live = false; };
  }, [account, selectedId, board]);

  useEffect(() => {
    if (!account || board.length === 0) {
      setMySupportIds(new Set());
      return;
    }
    let live = true;
    void Promise.all(board.map(async (d) => {
      try {
        const own = await readSupport(d.demandId, account);
        return own.commitment > 0n ? d.demandId.toString() : null;
      } catch {
        return null;
      }
    })).then((ids) => {
      if (live) setMySupportIds(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => { live = false; };
  }, [account, board]);

  async function connect() {
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

  const activity = account
    ? board.filter((d) => d.creator.toLowerCase() === account.toLowerCase()
      || d.builder.toLowerCase() === account.toLowerCase()
      || mySupportIds.has(d.demandId.toString()))
    : [];

  return (
    <>
      <header className="top">
        <div className="brand">
          <h1>UNMET</h1>
          <p>The market for what agents need but cannot buy yet.</p>
        </div>
        <div className="wallet-box">
          <div>X Layer {CHAIN_ID}</div>
          <div>{account ? <strong>{short(account)}</strong> : "wallet disconnected"}</div>
          <button className="ghost" disabled={busy} onClick={() => void connect()}>
            {account ? "Reconnect" : "Connect wallet"}
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}>Demand</button>
        <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>Create</button>
        <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>My Activity</button>
        <button onClick={() => void refresh()} disabled={busy}>Refresh chain</button>
      </nav>

      {!DEMAND_CONTRACT && <div className="status-line err">VITE_DEMAND_CONTRACT is not configured.</div>}
      {!chainOk && <div className="status-line err">Wallet is on the wrong network. A write will request X Layer {CHAIN_ID}.</div>}
      {status && <div className={`status-line ${status.includes("success") ? "ok" : status.includes("pending") ? "" : "err"}`}>{status}</div>}
      {lastTx && <div className="status-line">tx <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer"><code>{lastTx}</code></a></div>}

      {tab === "board" && <DemandBoard board={board} onSelect={setSelectedId} />}
      {tab === "create" && <CreatePanel busy={busy} run={run} />}
      {tab === "activity" && (
        <section className="panel">
          <h2>My Activity</h2>
          {!account ? <div className="empty">Connect a wallet to see your activity.</div>
            : activity.length === 0 ? <div className="empty">No onchain activity for this wallet.</div>
            : <div className="grid">{activity.map((d) => <DemandCard key={d.demandId.toString()} demand={d} onSelect={setSelectedId} />)}</div>}
        </section>
      )}

      {selected && (
        <DemandDetail
          demand={selected}
          support={support}
          account={account}
          busy={busy}
          close={() => setSelectedId(null)}
          run={run}
        />
      )}

      <footer className="foot">
        Contract: <code>{DEMAND_CONTRACT ?? "not configured"}</code> · USD₮0: <code>{PAYMENT_TOKEN}</code>
      </footer>
    </>
  );
}

function DemandBoard({ board, onSelect }: { board: DemandView[]; onSelect: (id: bigint) => void }) {
  return (
    <section className="panel">
      <h2>Funded Demand</h2>
      <p className="muted">Canonical state comes directly from AgentDemand on X Layer.</p>
      {board.length === 0 ? <div className="empty">No demands yet.</div> : (
        <div className="grid">
          {board.map((d) => <DemandCard key={d.demandId.toString()} demand={d} onSelect={onSelect} />)}
        </div>
      )}
    </section>
  );
}

function DemandCard({ demand, onSelect }: { demand: DemandView; onSelect: (id: bigint) => void }) {
  const state = effectiveStatus(demand);
  return (
    <article className="card" onClick={() => onSelect(demand.demandId)}>
      <h3>#{demand.demandId.toString()} {demand.capability}</h3>
      <div className="meta">
        <div>{demand.status === 2 ? "Refundable escrow" : "Current escrow"}<b>{formatUsd0(demand.committed)} USD₮0</b></div>
        <div>Supporters<b>{demand.supporterCount}</b></div>
        <div>Expected calls<b>{demand.expectedCalls.toString()}</b></div>
        <div>Max price<b>{formatUsd0(demand.maxUnitPrice)} USD₮0</b></div>
      </div>
      <span className={`badge ${state}`}>{state}</span>
    </article>
  );
}

function DemandDetail({
  demand, support, account, busy, close, run,
}: {
  demand: DemandView;
  support: SupportView;
  account: Address | null;
  busy: boolean;
  close: () => void;
  run: (label: string, fn: () => Promise<Hash>) => Promise<void>;
}) {
  const [supportAmount, setSupportAmount] = useState("0.05");
  const [supportCalls, setSupportCalls] = useState("1000");
  const [serviceUrl, setServiceUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const now = Math.floor(Date.now() / 1000);
  const state = effectiveStatus(demand, now);
  const reviewExpired = demand.status === 1 && Number(demand.reviewEndsAt) <= now;
  const canReopen = (reviewExpired || demand.candidateRejected) && !demand.quorumReached && Number(demand.deadline) > now;
  const safeUrl = safeHttpsUrl(demand.serviceUrl);
  const percent = demand.approvalRequired === 0n ? 0 : Math.min(100, Number((demand.approvalWeight * 10_000n) / demand.approvalRequired) / 100);

  return (
    <section className="panel detail">
      <div className="detail-title">
        <h2>Demand #{demand.demandId.toString()} — {demand.capability}</h2>
        <button className="ghost" onClick={close}>Close</button>
      </div>
      <dl>
        <dt>Status</dt><dd>{state}</dd>
        <dt>Specification</dt><dd>{demand.specification}</dd>
        <dt>Creator</dt><dd>{demand.creator}</dd>
        <dt>Builder</dt><dd>{demand.builder}</dd>
        <dt>Current escrow</dt><dd>{formatUsd0(demand.committed)} USD₮0</dd>
        <dt>Review snapshot</dt><dd>{formatUsd0(demand.reviewCommitted)} USD₮0</dd>
        <dt>Historical supporters</dt><dd>{demand.supporterCount}</dd>
        <dt>Historical expected calls</dt><dd>{demand.expectedCalls.toString()}</dd>
        <dt>Max unit price</dt><dd>{formatUsd0(demand.maxUnitPrice)} USD₮0</dd>
        <dt>Deadline</dt><dd>{iso(demand.deadline)}</dd>
        <dt>Review ends</dt><dd>{demand.reviewEndsAt === 0n ? "—" : iso(demand.reviewEndsAt)}</dd>
        <dt>Service URL</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{safeUrl}</a> : demand.serviceUrl || "—"}</dd>
        <dt>Evidence hash</dt><dd>{demand.evidenceHash}</dd>
        <dt>Your commitment</dt><dd>{account ? `${formatUsd0(support.commitment)} USD₮0` : "connect wallet"}</dd>
        <dt>Approval</dt>
        <dd>
          {formatUsd0(demand.approvalWeight)} / {formatUsd0(demand.approvalRequired)} USD₮0 weighted approval
          <div className="progress"><span style={{ width: `${percent}%` }} /></div>
          <span className="muted">Only wallets that explicitly approve are settled to the builder.</span>
        </dd>
        <dt>Rejection</dt>
        <dd>{formatUsd0(demand.rejectionWeight)} / {formatUsd0(demand.rejectionThreshold)} USD₮0 to block this candidate</dd>
      </dl>

      <div className="actions actions-column">
        {state === "OPEN" && (
          <div className="action-block">
            <h3>Support demand</h3>
            <input aria-label="Support amount" value={supportAmount} onChange={(e) => setSupportAmount(e.target.value)} placeholder="USD₮0" />
            <input aria-label="Expected calls" value={supportCalls} onChange={(e) => setSupportCalls(e.target.value)} placeholder="Expected calls" />
            <button className="primary" disabled={busy || !account} onClick={() => void run("support", () => supportDemand(demand.demandId, supportAmount, supportCalls))}>Support</button>
          </div>
        )}

        {state === "OPEN" && (
          <div className="action-block">
            <h3>Submit service</h3>
            <input aria-label="Service URL" value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://service.example/api" />
            <textarea aria-label="Evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence JSON/text or 0x bytes32 hash" />
            <button className="primary" disabled={busy || !account} onClick={() => void run("submit", () => submitService(demand.demandId, serviceUrl, evidence))}>Submit</button>
          </div>
        )}

        {demand.status === 1 && !reviewExpired && support.commitment > 0n && !support.approved && !support.rejected && (
          <>
            <button className="primary" disabled={busy || !account} onClick={() => void run("approve", () => approveService(demand.demandId))}>Approve candidate</button>
            <button className="danger" disabled={busy || !account} onClick={() => void run("reject", () => rejectService(demand.demandId))}>Reject candidate</button>
          </>
        )}
        {demand.status === 1 && support.approved && <span className="status-line ok">You approved the current submission; your commitment is included in builder settlement.</span>}
        {demand.status === 1 && support.rejected && <span className="status-line err">You rejected the current submission.</span>}
        {demand.status === 1 && demand.quorumReached && (
          <button className="primary" disabled={busy} onClick={() => void run("finalize", () => finalizeDemand(demand.demandId))}>Finalize payout</button>
        )}
        {canReopen && (
          <button className="ghost" disabled={busy || !account} onClick={() => void run("reopen", () => reopenDemand(demand.demandId))}>Reject expired review & reopen</button>
        )}
        {support.refundable && (
          <button className="danger" disabled={busy || !account} onClick={() => void run("refund", () => refundDemand(demand.demandId))}>Refund {formatUsd0(support.commitment)} USD₮0</button>
        )}
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
    <section className="panel">
      <h2>Create funded demand</h2>
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        void run("create", () => createDemand({ capability, specification, maxPrice, expectedCalls, deadlineDays, commitment }));
      }}>
        <label>Capability slug<input value={capability} onChange={(e) => setCapability(e.target.value)} maxLength={64} required /></label>
        <label>Specification<textarea value={specification} onChange={(e) => setSpecification(e.target.value)} maxLength={2048} required /></label>
        <label>Max unit price (USD₮0)<input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} required /></label>
        <label>Expected calls<input inputMode="numeric" value={expectedCalls} onChange={(e) => setExpectedCalls(e.target.value)} required /></label>
        <label>Deadline (days from now)<input inputMode="decimal" value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} required /></label>
        <label>Initial commitment (USD₮0)<input inputMode="decimal" value={commitment} onChange={(e) => setCommitment(e.target.value)} required /></label>
        <button className="primary" disabled={busy} type="submit">Create demand</button>
        <div className="status-line">Funds are locked in AgentDemand until fulfillment or a valid refund path. Contract: {DEMAND_CONTRACT ?? "not configured"}.</div>
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

function iso(value: bigint): string { return new Date(Number(value) * 1000).toISOString(); }
function short(value: string): string { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "INTERNAL_ERROR";
  const known = error.message.match(/(WALLET_[A-Z_]+|CHAIN_[A-Z_]+|DEMAND_[A-Z_]+|SUPPORT_[A-Z_]+|SUBMISSION_[A-Z_]+)/)?.[1];
  return known ?? error.message.slice(0, 180);
}
