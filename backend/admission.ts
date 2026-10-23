import type { RequestHandler } from "express";
import type { OperationalConfig } from "./config.ts";

export function rateLimiter(config: OperationalConfig, now = Date.now) {
  const clients = new Map<string, { count: number; expires: number }>();
  return (route: string, limit: number): RequestHandler => (req, res, next) => {
    const time = now();
    // Insertion order follows expiration because windows are never extended.
    for (const [key, entry] of clients) {
      if (entry.expires > time) break;
      clients.delete(key);
    }
    const key = route + ":" + (req.ip || req.socket.remoteAddress || "unknown");
    let entry = clients.get(key);
    if (!entry) {
      if (clients.size >= config.rateMaxKeys) {
        res.setHeader("retry-after", "1");
        res.status(503).json({ error: { code: "LIMITER_CAPACITY", message: "Service temporarily unavailable" } });
        return;
      }
      entry = { count: 0, expires: time + config.rateWindowMs };
      clients.set(key, entry);
    }
    if (entry.count >= limit) {
      res.setHeader("retry-after", String(Math.max(1, Math.ceil((entry.expires - time) / 1000))));
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Request limit exceeded" } });
      return;
    }
    entry.count++;
    next();
  };
}

export function concurrencyGate(limit: number): RequestHandler {
  let active = 0;
  return (req, res, next) => {
    if (active >= limit) {
      res.setHeader("retry-after", "1");
      res.status(503).json({ error: { code: "OVER_CAPACITY", message: "Service temporarily unavailable" } });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      req.off("aborted", release);
      res.off("finish", release);
      res.off("close", release);
      res.off("error", release);
    };
    req.once("aborted", release);
    res.once("finish", release);
    res.once("close", release);
    res.once("error", release);
    next();
  };
}
