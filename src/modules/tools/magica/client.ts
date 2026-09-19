import { env } from "../../../lib/env";
import {
  MagicaRunResponseSchema,
  MagicaStatusResponseSchema,
} from "./schemas";

const MAGICA_REQUEST_TIMEOUT_MS = 30_000;

export class MagicaProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MagicaProviderError";
  }
}

export async function startMagicaRun(params: {
  nodeType: string;
  input: Record<string, unknown>;
  subModelId?: string;
}) {
  const response = await fetchWithTimeout(
    `${env.MAGICA_BASE_URL}/v1/nodes/${params.nodeType}/run`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MAGICA_API_KEY}`,
      },
      body: JSON.stringify({
        nodeType: params.nodeType,
        input: params.input,
        ...(params.subModelId
          ? { subModelId: params.subModelId }
          : {}),
      }),
    },
  );

  const rawBody = await response.text();

  if (!response.ok) {
    throw toMagicaError(
      "start",
      response.status,
      rawBody,
    );
  }

  let json: unknown;

  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(
      "Magica returned invalid JSON from start endpoint",
    );
  }

  return MagicaRunResponseSchema.parse(json);
}

export async function getMagicaRun(runId: string) {
  const response = await fetchWithTimeout(
    `${env.MAGICA_BASE_URL}/v1/nodes/runs/${encodeURIComponent(runId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.MAGICA_API_KEY}`,
      },
    },
  );

  const rawBody = await response.text();

  if (!response.ok) {
    throw toMagicaError(
      "polling",
      response.status,
      rawBody,
    );
  }

  let json: unknown;

  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(
      "Magica returned invalid JSON from polling endpoint",
    );
  }

  return MagicaStatusResponseSchema.parse(json);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    MAGICA_REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new MagicaProviderError(
        "Magica request timed out",
        408,
        "MAGICA_TIMEOUT",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toMagicaError(
  phase: string,
  status: number,
  body: string,
) {
  const code =
    status === 401
      ? "MAGICA_UNAUTHORIZED"
      : status === 429
        ? "MAGICA_RATE_LIMITED"
        : status >= 500
          ? "MAGICA_UNAVAILABLE"
          : "MAGICA_REQUEST_FAILED";

  return new MagicaProviderError(
    `Magica ${phase} request failed (${status}): ${body}`,
    status,
    code,
  );
}
