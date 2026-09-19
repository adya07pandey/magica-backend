export function extractImageGenerationPrompt(contentBlocks: unknown) {
  if (!Array.isArray(contentBlocks)) {
    return null;
  }

  const prompt = contentBlocks
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

  if (!prompt) {
    return null;
  }

  const asksHow =
    /\b(how|why|what)\b[\s\S]{0,40}\b(generate|create|make|draw|render|produce)\b/i.test(
      prompt,
    );
  const requestsImage =
    /\b(generate|create|make|draw|render|produce)\b[\s\S]{0,120}\b(image|picture|photo|illustration|artwork)\b/i.test(
      prompt,
    );

  return requestsImage && !asksHow ? prompt : null;
}
