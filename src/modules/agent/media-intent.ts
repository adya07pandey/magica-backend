import type { ToolCall, ToolDefinition } from "./model.types";
import { extractImageGenerationPrompt } from "./image-intent";

const MEDIA_TOOL_NAMES = new Set([
  "gpt_image_2",
  "crop_image",
  "merge_videos",
]);

export function detectRequestedMediaTools(contentBlocks: unknown) {
  const text = extractText(contentBlocks);
  const requested = new Set<string>();

  if (extractImageGenerationPrompt(contentBlocks)) {
    requested.add("gpt_image_2");
  }

  if (/\bcrop(?:ped|ping)?\b/i.test(text)) {
    requested.add("crop_image");
  }

  if (
    /\b(?:merge|combine|join|stitch|concatenate)\b[\s\S]{0,100}\b(?:videos?|clips?|footage|files?|them|these)\b/i.test(
      text,
    ) ||
    /\b(?:videos?|clips?|footage)\b[\s\S]{0,100}\b(?:merge|combine|join|stitch|concatenate)\b/i.test(
      text,
    )
  ) {
    requested.add("merge_videos");
  }

  return requested.size > 0 ? requested : null;
}

export function restrictToolsToMediaIntent(
  tools: ToolDefinition[],
  requestedMediaTools: Set<string> | null,
) {
  if (!requestedMediaTools) {
    return tools;
  }

  return tools.filter(
    (tool) =>
      !MEDIA_TOOL_NAMES.has(tool.name) ||
      requestedMediaTools.has(tool.name),
  );
}

export function restrictToolCallsToMediaIntent(
  toolCalls: ToolCall[],
  requestedMediaTools: Set<string> | null,
) {
  if (!requestedMediaTools) {
    return { allowed: toolCalls, rejected: [] as ToolCall[] };
  }

  const allowed: ToolCall[] = [];
  const rejected: ToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (
      MEDIA_TOOL_NAMES.has(toolCall.name) &&
      !requestedMediaTools.has(toolCall.name)
    ) {
      rejected.push(toolCall);
    } else {
      allowed.push(toolCall);
    }
  }

  return { allowed, rejected };
}

export function needsVideoExclusionChoice(
  contentBlocks: unknown,
  filenames: string[],
) {
  if (filenames.length < 3) return false;

  const text = extractText(contentBlocks).toLocaleLowerCase();
  if (!/\b(?:d?elete|remove|exclude|omit|drop)\b/i.test(text)) {
    return false;
  }

  if (
    /\b(?:first|second|third|fourth|last|1st|2nd|3rd|4th)\b/i.test(text) ||
    /\bvideo\s*(?:#\s*)?[1-9]\b/i.test(text)
  ) {
    return false;
  }

  const filenameWords = filenames.map(uniqueWords);
  const wordCounts = new Map<string, number>();
  for (const words of filenameWords) {
    for (const word of new Set(words)) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  const namedVideo = filenameWords.some((words) =>
    words.some((word) => wordCounts.get(word) === 1 && text.includes(word)),
  );

  return !namedVideo;
}

function extractText(contentBlocks: unknown) {
  if (!Array.isArray(contentBlocks)) {
    return "";
  }

  return contentBlocks
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function uniqueWords(value: string) {
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) =>
      word.length >= 4 &&
      !["video", "vidssave", "italy", "mp4", "144p", "240p"].includes(
        word,
      ),
  );
}
