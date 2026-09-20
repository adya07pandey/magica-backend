import {
  startMagicaRun,
  getMagicaRun,
} from "../magica/client";

import type {
  MergeVideosInput,
  MergeVideosOutput,
} from "./schema";

import type { ToolExecutionContext } from "../core/types";
import { throwIfRunCancelled } from "../core/cancellation";

export async function executeMergeVideos(
  input: MergeVideosInput,
  context: ToolExecutionContext,
): Promise<MergeVideosOutput> {
  const toolStartedAt = Date.now();
  const startStartedAt = Date.now();
  const started = await startMagicaRun({
    nodeType: "merge_videos",

    input: {
      video_urls: input.video_urls,
      transition: input.transition,
    },
  });
  logTiming("merge_videos start request", startStartedAt, {
    providerRunId: started.providerRunId,
  });

  const pollStartedAt = Date.now();
  const polled = await pollMagicaRun(started.providerRunId, context.runId);
  const result = polled.response;
  logTiming("merge_videos polling", pollStartedAt, {
    providerRunId: started.providerRunId,
    status: result.status,
    attempts: polled.attempts,
  });

  if (result.status === "FAILED") {
    throw new Error(
      result.error ?? "Merge Videos execution failed",
    );
  }

  const videoUrl = extractVideoUrl(result.output);

  if (
    result.status === "COMPLETED" &&
    !videoUrl
  ) {
    throw new Error(
      "Merge Videos completed without video output",
    );
  }

  const output: MergeVideosOutput = {
    providerRunId: started.providerRunId,
    status: result.status,
    ...(videoUrl
      ? { video_url: videoUrl }
      : {}),
    ...(result.creditUsed !== undefined
      ? { creditUsed: result.creditUsed }
      : {}),
  };
  logTiming("merge_videos total", toolStartedAt, {
    providerRunId: started.providerRunId,
    status: result.status,
  });
  return output;
}

function extractVideoUrl(
  output:
    | {
        result?: string[];
        video_url?: string;
        video_urls?: string[];
      }
    | null
    | undefined,
) {
  return (
    output?.video_url ??
    output?.video_urls?.[0] ??
    output?.result?.[0]
  );
}

async function pollMagicaRun(
  runId: string,
  agentRunId: string,
) {
  const MAX_POLLS = 480;
  const POLL_INTERVAL_MS = 1_250;

  for (
    let attempt = 0;
    attempt < MAX_POLLS;
    attempt++
  ) {
    await throwIfRunCancelled(agentRunId);
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
