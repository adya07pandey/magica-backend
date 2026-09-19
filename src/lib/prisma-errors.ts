export function isPrismaUniqueConstraintError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
  };

  return candidate.code === "P2002";
}