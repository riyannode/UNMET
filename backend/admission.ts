import { isIP } from "node:net";
import type { RequestHandler, Response } from "express";
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
    const ip = req.ip || req.socket.remoteAddress;
    if (!ip || !isIP(ip)) {
      res.setHeader("retry-after", "1");
      res.status(503).json({ error: { code: "CLIENT_IP_UNAVAILABLE", message: "Client identity unavailable" } });
      return;
    }
    const key = route + ":" + ip;
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

type Admission = { pending: number; ended: boolean; release: () => void };
const admissions = new WeakMap<Response, Admission>();

export function admittedWork(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const admission = admissions.get(res);
    if (admission) admission.pending++;
    void (async () => {
      try {
        if (req.aborted || res.destroyed) {
          res.statusCode = 503;
          res.end();
          return;
        }
        await handler(req, res, next);
      } catch (error) { next(error); }
      finally {
        if (admission) {
          admission.pending--;
          admission.release();
        }
      }
    })();
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
    const admission: Admission = {
      pending: 0,
      ended: false,
      release: () => {
        if (released || !admission.ended || admission.pending !== 0) return;
        released = true;
        active--;
        admissions.delete(res);
        req.off("aborted", end);
        res.off("finish", end);
        res.off("close", end);
        res.off("error", end);
      },
    };
    const end = () => {
      admission.ended = true;
      admission.release();
    };
    admissions.set(res, admission);
    req.once("aborted", end);
    res.once("finish", end);
    res.once("close", end);
    res.once("error", end);
    next();
  };
}
