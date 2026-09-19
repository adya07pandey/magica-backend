import Redis from "ioredis";

import { env } from "./env";

const configuredRedisUrl = new URL(env.REDIS_URL);
const redisUrl =
  configuredRedisUrl.hostname.endsWith(".upstash.io") &&
  configuredRedisUrl.protocol === "redis:"
    ? env.REDIS_URL.replace(/^redis:\/\//, "rediss://")
    : env.REDIS_URL;

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 0,
  connectTimeout: 750,
  commandTimeout: 750,
  enableOfflineQueue: false,
  enableReadyCheck: false,
});

// Rate limiting is optional during local development. The request layer falls
// back to an in-memory window if Redis is unavailable.
redis.on("error", () => undefined);
