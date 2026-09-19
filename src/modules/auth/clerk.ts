import { createClerkClient } from "@clerk/backend";
import { env } from "../../lib/env";

export const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
});