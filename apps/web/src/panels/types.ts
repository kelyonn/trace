import type { StatusResponse } from "@trace/shared-types";

export type StatusPayload = StatusResponse & { activeSourceId?: string | null };
