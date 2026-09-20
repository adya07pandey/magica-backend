export type AgentExecutionMode = "inline" | "trigger";

type ExecutionEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "AGENT_EXECUTION_MODE" | "NODE_ENV" | "TRIGGER_SECRET_KEY"
  >
>;

export function resolveAgentExecutionMode(
  environment: ExecutionEnvironment,
): AgentExecutionMode {
  const configured = environment.AGENT_EXECUTION_MODE;
  const mode =
    configured === "inline" || configured === "trigger"
      ? configured
      : environment.TRIGGER_SECRET_KEY
        ? "trigger"
        : "inline";

  if (
    mode === "trigger" &&
    environment.NODE_ENV === "production" &&
    environment.TRIGGER_SECRET_KEY?.startsWith("tr_dev_")
  ) {
    throw new Error(
      "TRIGGER_SECRET_KEY is a development key. Production must use a tr_prod_ key from the same Trigger.dev project.",
    );
  }

  return mode;
}

export function getAgentExecutionMode(): AgentExecutionMode {
  return resolveAgentExecutionMode(process.env);
}
