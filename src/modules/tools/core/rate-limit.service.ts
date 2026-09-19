import { redis } from "../../../lib/redis";

const WINDOW_SECONDS = 60;
const MAX_TOOL_CALLS_PER_MINUTE = 20;

export async function checkToolRateLimit(userId: string) {
  const key = `tool-rate-limit:user:${userId}`;

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  if (count > MAX_TOOL_CALLS_PER_MINUTE) {
    const ttl = await redis.ttl(key);

    throw new Error(
      `Tool rate limit exceeded. Try again in ${Math.max(ttl, 1)} seconds.`,
    );
  }

  return {
    allowed: true,
    remaining: Math.max(
      MAX_TOOL_CALLS_PER_MINUTE - count,
      0,
    ),
  };
}