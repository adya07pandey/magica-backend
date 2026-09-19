import { env } from "./env";

export const corsHeaders = {
  "Access-Control-Allow-Origin": env.FRONTEND_URL,
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key",
};
