import { auth } from "@clerk/nextjs/server";
import { getOrCreateUser } from "./auth.service";

const USER_CACHE_TTL_MS = 60_000;

type CurrentUser = Awaited<ReturnType<typeof getOrCreateUser>>;

const userCache = new Map<
  string,
  { expiresAt: number; value: Promise<CurrentUser> }
>();

export async function getCurrentUser() {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  const cached = userCache.get(userId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = getOrCreateUser({ clerkUserId: userId }).catch((error) => {
    userCache.delete(userId);
    throw error;
  });

  userCache.set(userId, {
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
    value,
  });

  return value;
}
