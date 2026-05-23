import { createRemoteJWKSet, jwtVerify } from "jose";

export const isAuthRequired = process.env.AUTH_REQUIRED === "true";
const apiKey = process.env.API_KEY ?? "";

export const keycloakEnabled = process.env.KEYCLOAK_ENABLED === "true";
const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8081";
const keycloakRealm = process.env.KEYCLOAK_REALM ?? "trace";

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

export function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === "/health";
}

function extractBearer(authHeader: string): string {
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export async function verifyJwt(token: string): Promise<boolean> {
  if (!keycloakEnabled || !looksLikeJwt(token)) return false;
  try {
    await jwtVerify(token, getJwks());
    return true;
  } catch {
    return false;
  }
}

/**
 * When AUTH_REQUIRED=true, accept a valid API key or (if Keycloak enabled) a valid JWT.
 */
export async function authenticate(
  authHeader: string,
  queryToken?: string
): Promise<{ ok: boolean; message?: string }> {
  if (!isAuthRequired) return { ok: true };

  const token = extractBearer(authHeader) || queryToken?.trim() || "";
  if (!token) {
    return { ok: false, message: "Missing credentials" };
  }

  if (await verifyJwt(token)) return { ok: true };
  if (apiKey && token === apiKey) return { ok: true };

  return { ok: false, message: "Invalid API key or token" };
}

export async function getRoleFromToken(
  authHeader: string,
  fallbackHeader: unknown
): Promise<string> {
  const token = extractBearer(authHeader);
  if (token && keycloakEnabled && looksLikeJwt(token)) {
    try {
      const { payload } = await jwtVerify(token, getJwks());
      const roles = (payload as Record<string, unknown>)["realm_access"] as
        | { roles?: string[] }
        | undefined;
      if (roles?.roles?.includes("admin")) return "admin";
      if (roles?.roles?.includes("analyst")) return "analyst";
    } catch {
      // fall through to header role
    }
  }
  return getRole({ "x-trace-role": fallbackHeader });
}

export function getRole(headers: Record<string, unknown>): string {
  const value = headers["x-trace-role"];
  const role = Array.isArray(value) ? value[0] : value;
  return typeof role === "string" && role.length > 0 ? role : "user";
}

export function maskRows(
  columns: { name: string; type: string }[],
  rows: unknown[][],
  role: string,
  columnsToMask?: string[]
): unknown[][] {
  const toMask =
    columnsToMask ?? (role === "admin" ? [] : maskColumns);
  if (role === "admin" || toMask.length === 0) return rows;

  const indexes = columns
    .map((col, i) => (toMask.includes(col.name) ? i : -1))
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
