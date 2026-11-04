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
import { queryClient } from "@/composables/query/queryClient";
import { ingestionTokensQuery, orgPasscodeQuery } from "@/services/organizations.queries";
import { b64EncodeStandard } from "@/utils/formatters";

// ingest routes read only the Authorization header, never the session cookie; the org token comes
// first because root's passcode only validates in the default org
const ingestAuth = async (org: string) => {
  const [tokens, res] = await Promise.all([
    queryClient.fetchQuery(ingestionTokensQuery(org)).catch(() => undefined),
    queryClient.fetchQuery(orgPasscodeQuery(org)),
  ]);
  const orgToken = ((tokens?.data ?? []) as { token?: string; enabled?: boolean }[]).find(
    (t) => t?.enabled && t.token,
  )?.token;
  const { user, passcode } = res?.data ?? {};
  const secret = orgToken ?? passcode;
  if (!secret) throw new Error("No ingestion credential for this user");
  return { Authorization: `Basic ${b64EncodeStandard(`${user}:${secret}`)}` };
};

export interface SampleDataState {
  status: "none" | "loaded";
  start_time?: number;
  end_time?: number;
  updated_at?: number;
  updated_by?: string;
}

const sampleData = {
  getState: (org: string) =>
    http().get<SampleDataState>(`/api/${org}/sample_data`, { skipAccessToast: true }),
  putState: (org: string, startUs: number, endUs: number) =>
    http().put<SampleDataState>(`/api/${org}/sample_data`, {
      status: "loaded",
      start_time: startUs,
      end_time: endUs,
    }),
  deleteState: (org: string) => http().delete(`/api/${org}/sample_data`),
  ingestLogs: async (org: string, stream: string, rows: unknown[]) =>
    http({ headers: await ingestAuth(org) }).post(`/api/${org}/${stream}/_json`, rows),
  ingestMetrics: async (org: string, rows: unknown[]) =>
    http({ headers: await ingestAuth(org) }).post(`/api/${org}/ingest/metrics/_json`, rows),
  ingestTraces: async (org: string, stream: string, payload: unknown) =>
    http({
      headers: {
        ...(await ingestAuth(org)),
        "Content-Type": "application/json",
        "stream-name": stream,
      },
    }).post(`/api/${org}/v1/traces`, payload),
};

export default sampleData;
