import type { Request } from "express";
import { getEnv } from "../config/env";

/**
 * Best-effort client IP for rate limiting. When TRUST_PROXY_HOPS > 0, uses first X-Forwarded-For hop.
 */
export function getInboundRequestIp(req: Request): string {
  const hops = getEnv().TRUST_PROXY_HOPS;
  if (hops > 0) {
    const xff = req.headers["x-forwarded-for"];
    const raw = typeof xff === "string" ? xff : Array.isArray(xff) ? xff[0] : "";
    const first = raw.split(",")[0]?.trim();
    if (first) {
      return first.slice(0, 128);
    }
  }
  const ip = req.ip;
  if (ip && typeof ip === "string") {
    return ip.slice(0, 128);
  }
  const sock = req.socket?.remoteAddress;
  if (sock) {
    return sock.slice(0, 128);
  }
  return "unknown";
}
