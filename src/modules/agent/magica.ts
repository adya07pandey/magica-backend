import type {
  AgentMessage,
  ModelProvider,
  ModelResponse,
} from "./model.types";

/**
 * Magica model provider.
 *
 * The actual API request will be implemented once the
 * supplied Magica model API contract is available.
 */
export const magicaProvider: ModelProvider = {
  name: "magica",

  async generate(
    _messages: AgentMessage[],
  ): Promise<ModelResponse> {
    void _messages;

    throw new Error(
      "Magica model provider is not configured yet",
    );
  },
};
