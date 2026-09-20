import assert from "node:assert/strict";
import test from "node:test";

import { readOpenRouterStream } from "../src/modules/agent/openrouter";

function sseBody(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

test("streams text deltas while assembling the final model response", async () => {
  const updates: string[] = [];
  const response = await readOpenRouterStream(
    sseBody([
      'data: {"model":"test/model","choices":[{"delta":{"content":"Geo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"metry"}}]}\n',
      '\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6},"choices":[]}\n\n',
      "data: [DONE]\n\n",
    ]),
    (_delta, content) => {
      updates.push(content);
    },
  );

  assert.deepEqual(updates, ["Geo", "Geometry"]);
  assert.equal(response.content, "Geometry");
  assert.equal(response.model, "test/model");
  assert.deepEqual(response.usage, {
    inputTokens: 4,
    outputTokens: 2,
    totalTokens: 6,
  });
});

test("assembles streamed tool calls without changing their arguments", async () => {
  const updates: string[] = [];
  const response = await readOpenRouterStream(
    sseBody([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"merge_","arguments":"{\\"transition\\":\\"no"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"videos","arguments":"ne\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
    (_delta, content) => {
      updates.push(content);
    },
  );

  assert.deepEqual(updates, []);
  assert.deepEqual(response.toolCalls, [
    {
      id: "call-1",
      name: "merge_videos",
      arguments: { transition: "none" },
    },
  ]);
});
