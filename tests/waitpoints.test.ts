import assert from "node:assert/strict";
import test from "node:test";

import { completedToolCredits } from "../src/modules/credits/tool-billing";
import { needsVideoExclusionChoice } from "../src/modules/agent/media-intent";
import {
  classifyResolutionAttempt,
  readCanonicalWaitpointResult,
} from "../src/modules/waitpoints/domain";
import { UserInputRequestSchema } from "../src/modules/waitpoints/schemas";

const request = {
  type: "OPTIONS" as const,
  question: "Which source should be permanently replaced?",
  importance: "IRREVERSIBLE_ACTION" as const,
  whyItMatters: "Choosing the wrong source would destroy saved work.",
  expiresInMinutes: 30,
  options: [
    { id: "a", label: "Source A", description: "Replace source A" },
    { id: "b", label: "Source B", description: "Replace source B" },
  ],
};

const baseRecord = {
  ownerUserId: "user-1",
  status: "PENDING",
  expiresAt: new Date("2026-09-20T13:00:00.000Z"),
  resolution: null,
};

test("accepts a valid owned resolution exactly once", () => {
  const resolution = { kind: "option" as const, optionId: "a" };
  assert.deepEqual(
    classifyResolutionAttempt({
      record: baseRecord,
      request,
      userId: "user-1",
      resolution,
      now: new Date("2026-09-20T12:00:00.000Z"),
    }),
    { kind: "ACCEPT" },
  );

  assert.deepEqual(
    classifyResolutionAttempt({
      record: { ...baseRecord, status: "RESOLVED", resolution },
      request,
      userId: "user-1",
      resolution,
      now: new Date("2026-09-20T12:00:00.000Z"),
    }),
    { kind: "DUPLICATE" },
  );
});

test("rejects expired, invalid, conflicting, and cross-user resolutions", () => {
  const valid = { kind: "option" as const, optionId: "a" };
  const attempt = (overrides: Partial<Parameters<typeof classifyResolutionAttempt>[0]>) =>
    classifyResolutionAttempt({
      record: baseRecord,
      request,
      userId: "user-1",
      resolution: valid,
      now: new Date("2026-09-20T12:00:00.000Z"),
      ...overrides,
    });

  assert.equal(attempt({ userId: "user-2" }).kind, "NOT_FOUND");
  assert.equal(attempt({ now: new Date("2026-09-20T14:00:00.000Z") }).kind, "EXPIRED");
  assert.equal(
    attempt({ resolution: { kind: "option", optionId: "missing" } }).kind,
    "INVALID_RESOLUTION",
  );
  assert.equal(
    attempt({
      record: { ...baseRecord, status: "RESOLVED", resolution: valid },
      resolution: { kind: "option", optionId: "b" },
    }).kind,
    "ALREADY_RESOLVED",
  );
});

test("a worker retry can recover the canonical stored resolution", () => {
  const stored = readCanonicalWaitpointResult({
    status: "RESOLVED",
    resolution: { kind: "option", optionId: "b" },
  });
  assert.deepEqual(stored, {
    status: "RESOLVED",
    resolution: { kind: "option", optionId: "b" },
  });
});

test("normalizes numeric timeout strings returned by routed models", () => {
  const parsed = UserInputRequestSchema.parse({
    type: "APPROVAL",
    question: "Should this irreversible operation continue?",
    importance: "IRREVERSIBLE_ACTION",
    whyItMatters: "The affected data cannot be restored afterward.",
    expiresInMinutes: "30",
  });

  assert.equal(parsed.expiresInMinutes, 30);
});

test("requires a choice when an exclusion does not identify one of three videos", () => {
  const filenames = [
    "ITALY - 8 Days Itinerary.mp4",
    "Positano Amalfi Coast Italy.mp4",
    "Two days in Venice Italy.mp4",
  ];

  assert.equal(
    needsVideoExclusionChoice(
      [{ type: "text", text: "Delete the video and merge the other two." }],
      filenames,
    ),
    true,
  );
  assert.equal(
    needsVideoExclusionChoice(
      [{ type: "text", text: "Delete the Positano video and merge the other two." }],
      filenames,
    ),
    false,
  );
  assert.equal(
    needsVideoExclusionChoice(
      [{ type: "text", text: "Delete the first video and merge the other two." }],
      filenames,
    ),
    false,
  );
});

test("only successful media tools consume application credits", () => {
  assert.equal(
    completedToolCredits({
      toolName: "crop_image",
      estimatedCredits: 5_000,
      output: { status: "COMPLETED" },
    }),
    5_000,
  );
  assert.equal(
    completedToolCredits({
      toolName: "crop_image",
      estimatedCredits: 5_000,
      output: { status: "FAILED" },
    }),
    0,
  );
  assert.equal(
    completedToolCredits({
      toolName: "request_user_input",
      estimatedCredits: 99_999,
      output: { status: "COMPLETED" },
    }),
    0,
  );
});
