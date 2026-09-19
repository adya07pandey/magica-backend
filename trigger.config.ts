import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_wkzwvxebfrtenusevnpi",

  runtime: "node-24",

  logLevel: "log",

  maxDuration: 3600,

  retries: {
    enabledInDev: true,

    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },

  dirs: ["./trigger"],

  build: {
    extensions: [
      additionalFiles({
        files: ["./agent-skills/**"],
      }),
      prismaExtension({
        mode: "modern",
      }),
    ],
  },
});
