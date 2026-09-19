export function getIdempotencyKey(
  request: Request,
): string | null {
  const value = request.headers.get("Idempotency-Key");

  if (!value) {
    return null;
  }

  const key = value.trim();

  if (key.length === 0 || key.length > 255) {
    return null;
  }

  return key;
}