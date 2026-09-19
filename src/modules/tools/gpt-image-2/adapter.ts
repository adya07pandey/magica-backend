import {
  startMagicaRun,
  getMagicaRun,
} from "../magica/client";

import type {
  GPTImage2Input,
  GPTImage2Output,
} from "./schema";

import type { ToolExecutionContext } from "../core/types";

export async function executeGPTImage2(
  input: GPTImage2Input,
  _context: ToolExecutionContext,
): Promise<GPTImage2Output> {
  void _context;

  const toolStartedAt = Date.now();
  const startStartedAt = Date.now();
  const started = await startMagicaRun({
    nodeType: "gpt_image_2",

    subModelId: "gpt-image-2-text",

    input: {
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      background: input.background,
      n: input.n,
      output_format: input.output_format,
    },
  });
  logTiming("gpt_image_2 start request", startStartedAt, {
    providerRunId: started.providerRunId,
  });

  const pollStartedAt = Date.now();
  const result = await pollMagicaRun(
    started.providerRunId,
  );
  logTiming("gpt_image_2 polling", pollStartedAt, {
    providerRunId: started.providerRunId,
    status: result.response.status,
    attempts: result.attempts,
  });

  if (result.response.status === "FAILED") {
    const output: GPTImage2Output = {
      providerRunId: started.providerRunId,
      status: "FAILED",
      image_urls: [],
      creditUsed: result.response.creditUsed,
      error:
        result.response.error ??
        "GPT Image 2 execution failed",
    };
    logTiming("gpt_image_2 total", toolStartedAt, {
      providerRunId: started.providerRunId,
      status: result.response.status,
    });
    return output;
  }

  const imageUrls =
    result.response.output?.result ?? [];

  if (
    result.response.status === "COMPLETED" &&
    imageUrls.length === 0
  ) {
    throw new Error(
      "GPT Image 2 completed without image output",
    );
  }

  const output: GPTImage2Output = {
    providerRunId: started.providerRunId,
    status: result.response.status,
    image_urls: imageUrls,
    creditUsed: result.response.creditUsed,
  };
  logTiming("gpt_image_2 total", toolStartedAt, {
    providerRunId: started.providerRunId,
    status: result.response.status,
  });
  return output;
}

async function pollMagicaRun(
  runId: string,
) {
  const MAX_POLLS = 480;
  const POLL_INTERVAL_MS = 1_250;

  for (
    let attempt = 0;
    attempt < MAX_POLLS;
    attempt++
  ) {
    const result =
      await getMagicaRun(runId);

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
