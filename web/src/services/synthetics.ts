// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
import http from "./http";
import store from "@/stores";

const STREAM_NAME = "synthetics_results";

/**
 * The API origin, for URLs that do NOT go through the axios wrapper.
 *
 * Everything else in this file is issued by `http()`, which sets
 * `baseURL: store.state.API_ENDPOINT`. Artifact URLs are different: they are
 * handed to `<img src>` and `fetch()` directly, so they carry no baseURL and
 * resolve against whatever origin serves the page. In dev that is the Vite
 * server on :8081, which has no `/api` route and no proxy — so every screenshot
 * and every evidence bundle 404s until the origin is spelled out here.
 *
 * Returns "" when the app is served from the API's own origin (`API_ENDPOINT`
 * is "/" or unset). Prefixing "/" would yield `//api/...`, which the browser
 * reads as protocol-relative — a request to a host literally named "api".
 */
function apiOrigin(): string {
  const base = store.state.API_ENDPOINT;
  if (!base || base === "/") return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

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
    return `${apiOrigin()}/api/${orgIdentifier}/synthetics/${synthetics_id}/artifact?key=${encodeURIComponent(key)}${folderParam}`;
  },

  /**
   * True when a resolved artifact URL points at OUR proxy endpoint rather than
   * at object storage.
   *
   * The two need OPPOSITE fetch credentials, and getting it wrong fails closed:
   * the proxy is cookie-authed, while a presigned object URL carries its auth in
   * the query signature and object storage sends no
   * `Access-Control-Allow-Credentials`, so asking for cookies there fails CORS.
   * Callers doing a raw `fetch` (the evidence bundle) must ask which they have —
   * a cross-origin `fetch` omits cookies by default, which is what turned a
   * proxy-mode bundle into a bare 401.
   *
   * Lives beside `artifactUrl` because that is what builds the shape it matches.
   *
   * KNOWN GAP: this only matches the ABSOLUTE shape `artifactUrl` builds. On
   * local-disk storage the presign response returns a ROOT-RELATIVE
   * `/api/{org}/synthetics/{id}/artifact?key=` instead (o2-enterprise
   * `job_api::presign_artifacts`), which this misses whenever `API_ENDPOINT`
   * names another origin — so that one deployment shape still fetches without
   * cookies. The durable fix is to stop inferring from the URL at all: the
   * presign response already states `mode: "presigned" | "proxy"`, and
   * `RunDetail.presignRunArtifacts` currently discards it.
   */
  isProxyArtifactUrl: (url: string) => url.startsWith(`${apiOrigin()}/api/`),

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
