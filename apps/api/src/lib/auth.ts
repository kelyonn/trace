import { createRemoteJWKSet, jwtVerify } from "jose";

export const isAuthRequired = process.env.AUTH_REQUIRED === "true";
const apiKey = process.env.API_KEY ?? "";

const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8081";
const keycloakRealm = process.env.KEYCLOAK_REALM ?? "trace";
const keycloakEnabled = process.env.KEYCLOAK_URL !== undefined;

// Lazily created JWKS — cached by jose so it doesn't re-fetch on every request
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!remoteJwks) {
    const url = new URL(`${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`);
    remoteJwks = createRemoteJWKSet(url, { cacheMaxAge: 600_000 });
  }
  return remoteJwks;
}

export const maskColumns = (process.env.MASK_COLUMNS ?? "name")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Extract role from JWT (Keycloak realm_access.roles) or x-trace-role header.
 * JWT takes precedence when present.
 */
export async function getRoleFromToken(authHeader: string, fallbackHeader: unknown): Promise<string> {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token && keycloakEnabled) {
    try {
      const { payload } = await jwtVerify(token, getJwks());
      const roles = (payload as Record<string, unknown>)["realm_access"] as
        | { roles?: string[] }
        | undefined;
      if (roles?.roles?.includes("admin")) return "admin";
      if (roles?.roles?.includes("analyst")) return "analyst";
    } catch {
      // Token invalid or Keycloak unreachable — fall through
    }
  }
  return getRole({ "x-trace-role": fallbackHeader });
}

export function getRole(headers: Record<string, unknown>): string {
  const value = headers["x-trace-role"];
  const role = Array.isArray(value) ? value[0] : value;
  return typeof role === "string" && role.length > 0 ? role : "user";
}

export function validateApiKey(authHeader: string): boolean {
  if (!isAuthRequired) return true;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token && token === apiKey);
}

export function maskRows(
  columns: { name: string; type: string }[],
  rows: unknown[][],
  role: string
): unknown[][] {
  if (role === "admin" || maskColumns.length === 0) return rows;

  const indexes = columns
    .map((col, i) => (maskColumns.includes(col.name) ? i : -1))
    .filter((i) => i >= 0);

  if (indexes.length === 0) return rows;

  return rows.map((row) => {
    const next = [...row];
    indexes.forEach((i) => {
      if (i < next.length) next[i] = "***";
    });
    return next;
  });
}
