import { verifyToken } from "@clerk/backend";
import { env } from "../../lib/env";

export type AuthenticatedUser = {
  clerkUserId: string;
};

export async function authenticateRequest(
  authorizationHeader: string | null,
): Promise<AuthenticatedUser> {
    
  if (!authorizationHeader) {
    throw new Error("Missing Authorization header");
  }

  if (!authorizationHeader.startsWith("Bearer ")) {
    throw new Error("Invalid Authorization header");
  }

  const token = authorizationHeader.slice("Bearer ".length);

  if (!token) {
    throw new Error("Missing authentication token");
  }

  const payload = await verifyToken(token, {
    secretKey: env.CLERK_SECRET_KEY,
  });

  if (!payload.sub) {
    throw new Error("Invalid authentication token");
  }

  return {
    clerkUserId: payload.sub,
  };
}