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
import { organizationKeys } from "@/services/organizations.querykeys";
import store from "@/stores";
import { b64EncodeStandard } from "@/utils/formatters";

// ingest routes read only the Authorization header, never the session cookie; the org token comes
// first because root's passcode only validates in the default org
const ingestAuth = async (org: string) => {
  const [tokens, read] = await Promise.allSettled([
    queryClient.fetchQuery(ingestionTokensQuery(org)),
    queryClient.fetchQuery(orgPasscodeQuery(org)),
  ]);
  const tokenList = tokens.status === "fulfilled" ? tokens.value?.data : undefined;
  const orgToken = ((tokenList ?? []) as { token?: string; enabled?: boolean }[]).find(
    (t) => t?.enabled && t.token,
  )?.token;
  // an org token is checked without the user, so a failed passcode read only matters without one
  if (!orgToken && read.status === "rejected") throw read.reason;
  const { user, passcode } = (read.status === "fulfilled" ? read.value?.data : undefined) ?? {};
  const secret = orgToken ?? passcode;
  if (!secret) throw new Error("No ingestion credential for this user");
  const name = user ?? (store.state.userInfo as { email?: string } | null)?.email;
  return { Authorization: `Basic ${b64EncodeStandard(`${name}:${secret}`)}` };
};

// the cached token may have been rotated elsewhere: drop it, read it again and send once more
const withFreshAuth = async <T>(
  org: string,
  send: (auth: Record<string, string>) => Promise<T>,
) => {
  try {
    return await send(await ingestAuth(org));
  } catch (e: any) {
    if (e?.response?.status !== 401) throw e;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: organizationKeys.ingestionTokens(org),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: organizationKeys.passcode(org),
        refetchType: "none",
      }),
    ]);
    return send(await ingestAuth(org));
  }
};

export interface SampleDataState {
  status: "none" | "loaded";
  start_time?: number;
  end_time?: number;
}

// windows whose save failed, so this tab's tour still has the absolute range
const unsavedWindows = new Map<string, SampleDataState>();

const sampleData = {
  keepWindow: (org: string, startUs: number, endUs: number) =>
    unsavedWindows.set(org, { status: "loaded", start_time: startUs, end_time: endUs }),
  getState: async (org: string) => {
    const res = await http().get<SampleDataState>(`/api/${org}/sample_data`, {
      skipAccessToast: true,
    });
    const kept = unsavedWindows.get(org);
    return kept && res.data?.status !== "loaded" ? { ...res, data: kept } : res;
  },
  putState: (org: string, startUs: number, endUs: number) =>
    http().put<SampleDataState>(`/api/${org}/sample_data`, {
      start_time: startUs,
      end_time: endUs,
    }),
  deleteState: (org: string) => {
    unsavedWindows.delete(org);
    return http().delete(`/api/${org}/sample_data`);
  },
  ingestLogs: (org: string, stream: string, rows: unknown[]) =>
    withFreshAuth(org, (headers) => http({ headers }).post(`/api/${org}/${stream}/_json`, rows)),
  ingestMetrics: (org: string, rows: unknown[]) =>
    withFreshAuth(org, (headers) =>
      http({ headers }).post(`/api/${org}/ingest/metrics/_json`, rows),
    ),
  ingestTraces: (org: string, stream: string, payload: unknown) =>
    withFreshAuth(org, (headers) =>
      http({
        headers: { ...headers, "Content-Type": "application/json", "stream-name": stream },
      }).post(`/api/${org}/v1/traces`, payload),
    ),
};

export default sampleData;
