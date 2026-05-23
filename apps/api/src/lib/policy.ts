import { maskColumns as envMaskColumns } from "./auth.js";

const opaUrl = process.env.OPA_URL ?? "http://localhost:8181";
export const opaEnabled = process.env.OPA_ENABLED === "true";

export type PolicyAction = "query" | "schema" | "explain" | "export" | "activate_source";

export type PolicyInput = {
  role: string;
  action: PolicyAction;
  sql?: string;
};

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b/i;
const MULTI_STMT_PATTERN = /;.+/s;

export function isSafeQuery(sql: string): boolean {
  if (WRITE_PATTERN.test(sql)) return false;
  const stripped = sql.trimEnd().replace(/;$/, "");
  if (MULTI_STMT_PATTERN.test(stripped)) return false;
  return true;
}

export async function evaluatePolicy(input: PolicyInput): Promise<boolean> {
  if (!opaEnabled) {
    if (input.action === "query" && input.sql) return isSafeQuery(input.sql);
    if (input.action === "export") return input.role === "admin";
    return true;
  }

  try {
    const response = await fetch(`${opaUrl}/v1/data/trace/allow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { result?: boolean };
    return result.result === true;
  } catch {
    if (process.env.AUTH_REQUIRED === "true") return false;
    if (input.action === "query" && input.sql) return isSafeQuery(input.sql);
    if (input.action === "export") return input.role === "admin";
    return true;
  }
}

/**
 * Fetch the OPA-derived set of columns to mask for a given role.
 * Falls back to the env-var list when OPA is disabled.
 */
export async function getMaskColumns(role: string): Promise<string[]> {
  if (role === "admin") return [];
  if (!opaEnabled) return envMaskColumns;

  try {
    const response = await fetch(`${opaUrl}/v1/data/trace/mask_columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { role } })
    });
    if (!response.ok) return envMaskColumns;
    const result = (await response.json()) as { result?: string[] | Record<string, boolean> };
    if (Array.isArray(result.result)) return result.result;
    if (result.result && typeof result.result === "object") {
      return Object.keys(result.result);
    }
    return envMaskColumns;
  } catch {
    return envMaskColumns;
  }
}
