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

/**
 * Reject when the body carries an error code, even on HTTP 200.
 *
 * The SLO API answers some failures with HTTP 200 and the real status inside
 * the payload (`{code: 501, message: "SLOs are disabled…"}` when
 * `ZO_SLO_ENABLED` is unset, for instance). axios only rejects on the HTTP
 * status, so without this every caller reads that as success: the list does
 * `res.data?.list ?? []` and renders EMPTY with no error, and a create
 * resolves, toasts "SLO saved" and redirects — telling the user their SLO was
 * saved when nothing was written. Silence is the worst possible reading of a
 * failure, so it is converted into a real rejection here, once, rather than in
 * each of the nine call sites.
 *
 * Success bodies carry `code: 200`, so the threshold is exact rather than a
 * guess about which shapes are errors.
 */
function rejectBodyErrors(res: any) {
  const code = res?.data?.code;
  if (typeof code === "number" && code >= 400) {
    const err: any = new Error(res.data?.message || `Request failed (${code})`);
    // Shaped like an axios error so callers reading `e.response.data.message`
    // — which is every one of them — keep working unchanged.
    err.response = { status: code, data: res.data };
    throw err;
  }
  return res;
}

const slos = {
  list: (org_identifier: string, folder?: string) => {
    const q = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    return http().get(`/api/${org_identifier}/slos${q}`).then(rejectBodyErrors);
  },

  get: (org_identifier: string, slo_id: string) => {
    return http().get(`/api/${org_identifier}/slos/${slo_id}`).then(rejectBodyErrors);
  },

  create: (org_identifier: string, data: object) => {
    return http().post(`/api/${org_identifier}/slos`, data).then(rejectBodyErrors);
  },

  update: (org_identifier: string, slo_id: string, data: object) => {
    return http().put(`/api/${org_identifier}/slos/${slo_id}`, data).then(rejectBodyErrors);
  },

  delete: (org_identifier: string, slo_id: string) => {
    return http().delete(`/api/${org_identifier}/slos/${slo_id}`).then(rejectBodyErrors);
  },

  // Separate from update so a relocation can never carry a definition change,
  // which would bump the SLO's generation and discard its measurement.
  move: (org_identifier: string, slo_ids: string[], dst_folder_id: string) => {
    return http()
      .post(`/api/${org_identifier}/slos/move`, {
        slo_ids,
        dst_folder_id,
      })
      .then(rejectBodyErrors);
  },

  // Separate from update so pausing can never carry a definition change with
  // it — and therefore can never bump the generation or discard measurement.
  setEnabled: (org_identifier: string, slo_id: string, value: boolean) => {
    return http()
      .put(`/api/${org_identifier}/slos/${slo_id}/enable?value=${value}`)
      .then(rejectBodyErrors);
  },

  groups: (org_identifier: string, slo_id: string) => {
    return http().get(`/api/${org_identifier}/slos/${slo_id}/groups`).then(rejectBodyErrors);
  },
};

export default slos;
