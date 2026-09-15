const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the value if it's a valid UUID string, otherwise null.
 * Use this before sending any user/session-derived ID into a Postgres
 * `uuid` column — demo/placeholder accounts (e.g. "demo-poc-user") are
 * not valid UUIDs and will cause a Postgres error:
 *   invalid input syntax for type uuid: "..."
 */
export function toValidUuidOrNull(
  value: string | null | undefined
): string | null {
  return value && UUID_RE.test(value) ? value : null;
}
