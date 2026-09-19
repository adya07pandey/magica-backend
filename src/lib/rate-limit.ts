import { redis } from "./redis";
import { env } from "./env";

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 20;
const localWindows = new Map<string, { count: number; expiresAt: number }>();

export async function checkRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const key = `rate-limit:user:${userId}`;

  try {
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      return await checkUpstashRateLimit(key);
    }

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    const ttl = await redis.ttl(key);
    return toResult(current, Math.max(0, ttl));
  } catch {
    const now = Date.now();
    const existing = localWindows.get(key);
    const window = !existing || existing.expiresAt <= now
      ? { count: 1, expiresAt: now + WINDOW_SECONDS * 1_000 }
      : { ...existing, count: existing.count + 1 };

    localWindows.set(key, window);
    return toResult(window.count, Math.ceil((window.expiresAt - now) / 1_000));
  }
}

async function checkUpstashRateLimit(key: string): Promise<RateLimitResult> {
  const response = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, WINDOW_SECONDS, "NX"],
      ["TTL", key],
    ]),
    signal: AbortSignal.timeout(1_000),
  });

  if (!response.ok) {
    throw new Error("Upstash rate limit request failed");
  }

  const results = (await response.json()) as Array<{ result?: unknown }>;
  const current = Number(results[0]?.result);
  const ttl = Number(results[2]?.result);

  if (!Number.isFinite(current)) {
    throw new Error("Upstash rate limit response was invalid");
  }

  return toResult(current, Math.max(0, ttl));
}

function toResult(current: number, retryAfterSeconds: number): RateLimitResult {
  return {
    allowed: current <= MAX_REQUESTS,
    limit: MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - current),
    retryAfterSeconds,
  };
}
