import type { ToolContract } from "../core/types";
import {
  UserInputRequestSchema,
  UserInputResultSchema,
} from "../../waitpoints/schemas";
import { createAndWaitForUserInput } from "../../waitpoints/waitpoint.service";

export const requestUserInputTool = {
  name: "request_user_input",
  description:
    "Pause for a button-based approval or option choice only when proceeding would risk an irreversible action, a material ambiguity, or materially different high-impact outcomes. Never use this tool to request files, URLs, text entry, credentials, or other free-form input; ask for those directly in a concise assistant response. Never ask about minor doubts, cosmetic preferences, naming, formatting, defaults, or easily reversible choices; choose a sensible default instead. Ask at most one concise question and provide 2-4 concrete options when possible.",
  inputSchema: UserInputRequestSchema,
  outputSchema: UserInputResultSchema,
  estimateCredits: () => 0,
  async execute(input, context) {
    return createAndWaitForUserInput({ request: input, context });
  },
} satisfies ToolContract<
  typeof UserInputRequestSchema,
  typeof UserInputResultSchema
>;
