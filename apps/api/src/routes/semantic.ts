import type { FastifyInstance } from "fastify";
import { promises as fs } from "fs";
import yaml from "js-yaml";
import type { SemanticModel } from "@trace/shared-types";
import { resolveRepoPath } from "../lib/paths.js";

const semanticPath = resolveRepoPath("services/query-engine/semantic.yml");

let cachedModel: SemanticModel | null = null;

async function loadSemanticModel(): Promise<SemanticModel> {
  if (cachedModel) return cachedModel;
  try {
    const raw = await fs.readFile(semanticPath, "utf8");
    cachedModel = yaml.load(raw) as SemanticModel;
    return cachedModel;
  } catch {
    return { version: "1", cubes: [] };
  }
}

export default async function semanticRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/semantic", async () => {
    const model = await loadSemanticModel();
    return model;
  });
}
