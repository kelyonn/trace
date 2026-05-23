import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a repo-relative path regardless of whether the API runs from repo root or apps/api. */
export function resolveRepoPath(...segments: string[]): string {
  const candidates = [
    path.resolve(process.cwd(), ...segments),
    path.resolve(process.cwd(), "../..", ...segments),
    path.resolve(moduleDir, "../../../../", ...segments)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
