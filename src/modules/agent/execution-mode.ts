export type AgentExecutionMode = "inline" | "trigger";

export function getAgentExecutionMode(): AgentExecutionMode {
  const configured = process.env.AGENT_EXECUTION_MODE;

  if (configured === "inline" || configured === "trigger") {
    return configured;
  }

  return process.env.TRIGGER_SECRET_KEY ? "trigger" : "inline";
}
