export function extractText(
  contentBlocks: unknown,
): string {
  if (!Array.isArray(contentBlocks)) {
    return "";
  }

  return contentBlocks
    .filter(
      (
        block,
      ): block is {
        type: string;
        text: string;
      } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}