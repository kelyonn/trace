import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, getRoleFromToken, isPublicPath } from "./auth.js";
import { getMaskColumns } from "./policy.js";

export type TraceContext = {
  role: string;
  maskColumns: string[];
};

declare module "fastify" {
  interface FastifyRequest {
    trace: TraceContext;
  }
}

function extractQueryToken(request: FastifyRequest): string | undefined {
  const q = request.query as { token?: string } | undefined;
  const value = q?.token;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function buildTraceContext(request: FastifyRequest): Promise<TraceContext> {
  const headers = request.headers as Record<string, unknown>;
  const authHeader = (headers.authorization as string | undefined) ?? "";
  const queryToken = extractQueryToken(request);
  const effectiveAuth =
    authHeader || (queryToken ? `Bearer ${queryToken}` : "");

  const role = await getRoleFromToken(effectiveAuth, headers["x-trace-role"]);
  const maskColumns = await getMaskColumns(role);
  return { role, maskColumns };
}

/** Attach auth + trace context hooks to a Fastify instance (call on the same scope as routes). */
export function attachTraceHooks(fastify: FastifyInstance): void {
  fastify.decorateRequest("trace", null);

  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPublicPath(request.url)) {
      const authHeader = (request.headers.authorization as string | undefined) ?? "";
      const queryToken = extractQueryToken(request);
      const auth = await authenticate(authHeader, queryToken);

      if (!auth.ok) {
        return reply.status(401).send({
          error: {
            code: "UNAUTHORIZED",
            message: auth.message ?? "Authentication required"
          }
        });
      }
    }

    request.trace = await buildTraceContext(request);
  });
}

export default async function traceContextPlugin(fastify: FastifyInstance): Promise<void> {
  attachTraceHooks(fastify);
}
