import { createHmac } from "node:crypto";

import { env } from "../../lib/env";

type WebhookEvent =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "tool.completed"
  | "tool.failed";

export async function emitWebhook(params: {
  event: WebhookEvent;
  payload: Record<string, unknown>;
}) {
  if (!env.WEBHOOK_URL) {
    return;
  }

  const body = JSON.stringify({
    event: params.event,
    createdAt: new Date().toISOString(),
    payload: params.payload,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.WEBHOOK_SECRET) {
    headers["X-Magica-Signature"] =
      createHmac("sha256", env.WEBHOOK_SECRET)
        .update(body)
        .digest("hex");
  }

  try {
    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers,
      body,
    });
  } catch (error) {
    console.error(
      "Failed to emit webhook",
      params.event,
      error,
    );
  }
}
