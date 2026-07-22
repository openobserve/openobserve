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
    return http().put(`/api/${orgIdentifier}/synthetics/${id}`, payload);
  },

  get: (orgIdentifier: string, id: string) => http().get(`/api/${orgIdentifier}/synthetics/${id}`),

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

  enable: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/${id}/enable`, payload),

  run: (orgIdentifier: string, id: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics/${id}/run`, payload),

  getRuns: (orgIdentifier: string, id: string, params?: Record<string, string | number>) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/runs`, { params }),

  getRun: (orgIdentifier: string, id: string, runId: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/runs/${runId}`),

  artifactUrl: (orgIdentifier: string, key: string) => {
    // Fallback proxy URL. key format:
    // synthetics/{org}/{synthetics_id}/{yyyy}/{mm}/{dd}/{run_id}/{execution_id|job_id}/{filename}
    const parts = key.split("/");
    const synthetics_id = parts[2] ?? "_";
    return `/api/${orgIdentifier}/synthetics/${synthetics_id}/artifact?key=${encodeURIComponent(key)}`;
  },

  // Batch-sign artifact download URLs. Returns { mode: "presigned" | "proxy",
  // expires_in, urls: [{key, url}] }. mode is decided by the backend from its
  // storage config (local disk → proxy, S3/MinIO/Azure → presigned).
  presignArtifacts: (orgIdentifier: string, syntheticsId: string, keys: string[]) =>
    http().post(`/api/${orgIdentifier}/synthetics/${syntheticsId}/artifacts/presign`, { keys }),

  getLocations: (orgIdentifier: string) => http().get(`/api/${orgIdentifier}/synthetics/locations`),

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
