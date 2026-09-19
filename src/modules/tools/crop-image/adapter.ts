import {
  startMagicaRun,
  getMagicaRun,
} from "../magica/client";

import type {
  CropImageInput,
  CropImageOutput,
} from "./schema";

import type { ToolExecutionContext } from "../core/types";

export async function executeCropImage(
  input: CropImageInput,
  _context: ToolExecutionContext,
): Promise<CropImageOutput> {
  void _context;

  const toolStartedAt = Date.now();
  const startStartedAt = Date.now();
  const started = await startMagicaRun({
    nodeType: "crop_image",

    input: {
      image_url: input.image_url,

      x_percent: input.x_percent,
      y_percent: input.y_percent,

      width_percent: input.width_percent,
      height_percent: input.height_percent,

      ...(input.width_px !== undefined
        ? { width_px: input.width_px }
        : {}),

      ...(input.height_px !== undefined
        ? { height_px: input.height_px }
        : {}),

      ...(input.x_px !== undefined
        ? { x_px: input.x_px }
        : {}),

      ...(input.y_px !== undefined
        ? { y_px: input.y_px }
        : {}),
    },
  });
  logTiming("crop_image start request", startStartedAt, {
    providerRunId: started.providerRunId,
  });

  const pollStartedAt = Date.now();
  const polled = await pollMagicaRun(started.providerRunId);
  const result = polled.response;
  logTiming("crop_image polling", pollStartedAt, {
    providerRunId: started.providerRunId,
    status: result.status,
    attempts: polled.attempts,
  });

  const imageUrl = extractImageUrl(result.output);

  if (result.status === "FAILED") {
    throw new Error(
      result.error ?? "Crop Image execution failed",
    );
  }

  if (
    result.status === "COMPLETED" &&
    !imageUrl
  ) {
    throw new Error(
      "Crop Image completed without an output image",
    );
  }

  const output: CropImageOutput = {
    providerRunId: started.providerRunId,
    status: result.status,
    ...(imageUrl
      ? { image_url: imageUrl }
      : {}),
    ...(result.creditUsed !== undefined
      ? { creditUsed: result.creditUsed }
      : {}),
  };
  logTiming("crop_image total", toolStartedAt, {
    providerRunId: started.providerRunId,
    status: result.status,
  });
  return output;
}

function extractImageUrl(
  output: { result?: string[]; image_url?: string; image_urls?: string[] } | null | undefined,
) {
  return (
    output?.image_url ??
    output?.image_urls?.[0] ??
    output?.result?.[0]
  );
}

async function pollMagicaRun(
  runId: string,
) {
  const MAX_POLLS = 480;
  const POLL_INTERVAL_MS = 1_250;

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const result = await getMagicaRun(runId);

    if (
      result.status === "COMPLETED" ||
      result.status === "FAILED"
    ) {
      return {
        response: result,
        attempts: attempt + 1,
      };
    }

    await new Promise((resolve) =>
      setTimeout(resolve, POLL_INTERVAL_MS),
    );
  }

  throw new Error(
    `Magica run ${runId} timed out`,
  );
}

function logTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  const durationMs = Date.now() - startedAt;
  const suffix = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";
  console.info(`[timing] ${label} ${durationMs}ms${suffix}`);
}
