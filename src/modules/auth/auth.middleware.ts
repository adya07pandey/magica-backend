import { authenticateRequest } from "./auth";

export async function requireAuth(
  authorizationHeader: string | null,
) {
  const authenticatedUser = await authenticateRequest(
    authorizationHeader,
  );

  return authenticatedUser;
}