type ProbeChannel = {
  port1: { onmessage: ((event: MessageEvent<number>) => void) | null; close(): void };
  port2: { postMessage(ticket: number): void; close(): void };
};

type Sample = {
  ticket: number;
  postedAt: number;
  resumedAt?: number;
  nextFrameAt?: number;
};

const WARMUP_MS = 500;
const SAMPLE_INTERVAL_MS = 100;
const MIN_STALL_MS = 4;
const STALL_FRAME_SHARE = 0.8;
const SUSTAINED_MS = 600;
const MIN_SAMPLES = 4;

export function createMagicRingsFrameBudget(
  onExceeded: () => void,
  channel: ProbeChannel = new MessageChannel(),
  now = () => performance.now(),
) {
  let ticket = 0;
  let sample: Sample | undefined;
  let firstFrameAt: number | undefined;
  let lastSampleAt = -Infinity;
  let overBudgetSince: number | undefined;
  let overBudgetSamples = 0;
  let closed = false;

  const clearStreak = () => {
    overBudgetSince = undefined;
    overBudgetSamples = 0;
  };

  const reset = () => {
    firstFrameAt = undefined;
    lastSampleAt = -Infinity;
    sample = undefined;
    clearStreak();
  };

  const dispose = () => {
    if (closed) return;
    closed = true;
    reset();
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  };

  const evaluate = () => {
    if (sample?.resumedAt === undefined || sample.nextFrameAt === undefined) return;
    const { postedAt, resumedAt, nextFrameAt } = sample;
    sample = undefined;
    const wait = resumedAt - postedAt;
    const interval = nextFrameAt - postedAt;

    if (interval <= 0 || wait < MIN_STALL_MS || wait < interval * STALL_FRAME_SHARE) {
      clearStreak();
      return;
    }

    overBudgetSince ??= postedAt;
    overBudgetSamples++;
    if (overBudgetSamples >= MIN_SAMPLES && nextFrameAt - overBudgetSince >= SUSTAINED_MS) {
      dispose();
      onExceeded();
    }
  };

  channel.port1.onmessage = ({ data }) => {
    if (sample?.ticket !== data) return;
    sample.resumedAt = now();
    evaluate();
  };

  const frame = () => {
    if (closed) return;
    const time = now();
    firstFrameAt ??= time;
    if (sample && sample.nextFrameAt === undefined) {
      sample.nextFrameAt = time;
      evaluate();
    }
    if (closed || sample || time - firstFrameAt < WARMUP_MS || time - lastSampleAt < SAMPLE_INTERVAL_MS) return;

    // The queued task also waits for compositor work that follows this RAF callback.
    lastSampleAt = time;
    sample = { ticket: ++ticket, postedAt: time };
    channel.port2.postMessage(ticket);
  };

  return { frame, reset, dispose };
}
