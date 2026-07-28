// Copyright 2026 OpenObserve Inc.
import http from "./http";

const STREAM_NAME = "synthetics_results";

export interface ListRunsPayload {
  query: {
    sql: string;
    start_time: number;
    end_time: number;
    from: number;
    size: number;
  };
}

export interface GetRunPayload {
  query: {
    sql: string;
    start_time: number;
    end_time: number;
    from: number;
    size: number;
  };
}

const syntheticsService = {
  create: (orgIdentifier: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().post(`/api/${orgIdentifier}/synthetics${params}`, payload);
  },

  update: (orgIdentifier: string, id: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().put(`/api/${orgIdentifier}/synthetics/${id}${params}`, payload);
  },

  // folderId is the check's folder (name), passed as ?folder= so RBAC can
  // resolve folder-scoped grants — mirrors alerts' per-item routes.
  get: (orgIdentifier: string, id: string, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().get(`/api/${orgIdentifier}/synthetics/${id}${params}`);
  },

  list: (orgIdentifier: string) => http().get(`/api/${orgIdentifier}/synthetics`),

  listByFolderId: (orgIdentifier: string, folderId?: string) => {
    const params = folderId && folderId !== "all" ? `?folder=${folderId}` : "";
    return http().get(`/api/${orgIdentifier}/synthetics${params}`);
  },

  delete: (orgIdentifier: string, id: string, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().delete(`/api/${orgIdentifier}/synthetics/${id}${params}`);
  },

  bulkDelete: (orgIdentifier: string, payload: { ids: string[] }, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().delete(`/api/${orgIdentifier}/synthetics${params}`, { data: payload });
  },

  enable: (orgIdentifier: string, id: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().put(`/api/${orgIdentifier}/synthetics/${id}/enable${params}`, payload);
  },

  run: (orgIdentifier: string, id: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().post(`/api/${orgIdentifier}/synthetics/${id}/run${params}`, payload);
  },

  getRuns: (
    orgIdentifier: string,
    id: string,
    params?: Record<string, string | number>,
    folderId?: string,
  ) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/runs`, {
      params: folderId ? { ...(params ?? {}), folder: folderId } : params,
    }),

  getRun: (orgIdentifier: string, id: string, runId: string, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().get(`/api/${orgIdentifier}/synthetics/${id}/runs/${runId}${params}`);
  },

  artifactUrl: (orgIdentifier: string, key: string, folderId?: string) => {
    // Fallback proxy URL. key format:
    // synthetics/{org}/{synthetics_id}/{yyyy}/{mm}/{dd}/{run_id}/{execution_id|job_id}/{filename}
    const parts = key.split("/");
    const synthetics_id = parts[2] ?? "_";
    const folderParam = folderId ? `&folder=${folderId}` : "";
    return `/api/${orgIdentifier}/synthetics/${synthetics_id}/artifact?key=${encodeURIComponent(key)}${folderParam}`;
  },

  // Batch-sign artifact download URLs. Returns { mode: "presigned" | "proxy",
  // expires_in, urls: [{key, url}] }. mode is decided by the backend from its
  // storage config (local disk → proxy, S3/MinIO/Azure → presigned).
  presignArtifacts: (
    orgIdentifier: string,
    syntheticsId: string,
    keys: string[],
    folderId?: string,
  ) => {
    const params = folderId ? `?folder=${folderId}` : "";
    return http().post(
      `/api/${orgIdentifier}/synthetics/${syntheticsId}/artifacts/presign${params}`,
      { keys },
    );
  },

  getLocations: (orgIdentifier: string) => http().get(`/api/${orgIdentifier}/synthetics/locations`),

  // ── Private locations ──────────────────────────────────────────────────
  getAgentSetup: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/agent-setup`),

  // ── Agent tokens (org-level o2syn_ probe credentials) ──────────────────
  listAgentTokens: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/agent-tokens`),

  createAgentToken: (orgIdentifier: string, name: string) =>
    http().post(`/api/${orgIdentifier}/synthetics/agent-tokens`, { name }),

  rotateAgentToken: (orgIdentifier: string, name?: string) =>
    http().post(`/api/${orgIdentifier}/synthetics/agent-tokens/rotate`, name ? { name } : {}),

  setAgentTokenEnabled: (orgIdentifier: string, name: string, enabled: boolean) =>
    http().patch(`/api/${orgIdentifier}/synthetics/agent-tokens/${encodeURIComponent(name)}`, {
      enabled,
    }),

  getLocation: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/locations/${id}`),

  createLocation: (orgIdentifier: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics/locations`, payload),

  updateLocation: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/locations/${id}`, payload),

  deleteLocation: (orgIdentifier: string, id: string) =>
    http().delete(`/api/${orgIdentifier}/synthetics/locations/${id}`),

  bulkDeleteLocations: (orgIdentifier: string, ids: string[]) =>
    http().delete(`/api/${orgIdentifier}/synthetics/locations`, { data: { ids } }),

  listRunsPayload(monitorId: string, startTime: number, endTime: number): ListRunsPayload {
    const sql = `SELECT * FROM "${STREAM_NAME}" WHERE synthetics_id = '${monitorId}' ORDER BY _timestamp DESC LIMIT 500`;
    return {
      query: {
        sql,
        start_time: startTime,
        end_time: endTime,
        from: 0,
        size: 500,
      },
    };
  },

  getRunPayload(
    monitorId: string,
    runId: string,
    startTime: number,
    endTime: number,
  ): GetRunPayload {
    const sql = `SELECT * FROM "${STREAM_NAME}" WHERE synthetics_id = '${monitorId}' AND run_id = '${runId}' LIMIT 1`;
    return {
      query: {
        sql,
        start_time: startTime,
        end_time: endTime,
        from: 0,
        size: 1,
      },
    };
  },
};

export default syntheticsService;
