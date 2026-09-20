import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgentExecutionMode } from "../src/modules/agent/execution-mode";

test("defaults to inline execution when Trigger is not configured", () => {
  assert.equal(resolveAgentExecutionMode({}), "inline");
});

test("uses Trigger when a compatible key is configured", () => {
  assert.equal(
    resolveAgentExecutionMode({
      NODE_ENV: "production",
      TRIGGER_SECRET_KEY: "tr_prod_example",
    }),
    "trigger",
  );
});

test("rejects a development Trigger key in production", () => {
  assert.throws(
    () =>
      resolveAgentExecutionMode({
        NODE_ENV: "production",
        AGENT_EXECUTION_MODE: "trigger",
        TRIGGER_SECRET_KEY: "tr_dev_example",
      }),
    /development key/,
  );
});

test("allows a development Trigger key outside production", () => {
  assert.equal(
    resolveAgentExecutionMode({
      NODE_ENV: "development",
      TRIGGER_SECRET_KEY: "tr_dev_example",
    }),
    "trigger",
  );
});
