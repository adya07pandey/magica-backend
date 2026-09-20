const BILLABLE_TOOL_NAMES = new Set([
  "crop_image",
  "gpt_image_2",
  "merge_videos",
]);

export function completedToolCredits(params: {
  toolName: string;
  estimatedCredits: number;
  output: unknown;
}) {
  if (!BILLABLE_TOOL_NAMES.has(params.toolName)) {
    return 0;
  }

  if (
    typeof params.output !== "object" ||
    params.output === null ||
    !("status" in params.output) ||
    params.output.status !== "COMPLETED"
  ) {
    return 0;
  }

  return params.estimatedCredits;
}
