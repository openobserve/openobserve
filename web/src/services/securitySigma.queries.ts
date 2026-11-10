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

import { queryOptions } from "@tanstack/vue-query";
import { orgKey } from "@/composables/query/keys";
import { LIVE_STALE_TIME, SESSION_STALE_TIME } from "@/composables/query/cachePolicy";
import securitySigma, {
  type CompiledSigma,
  type DetectionEvidence,
  type EvidenceParams,
  type MitreCoverage,
  type SigmaCatalog,
  type SigmaCompileRequest,
  type SigmaCompileResponse,
} from "./securitySigma";

/** Folds the server's per-rule reason and detection SQL into each compile, where the UI reads them. */
export function normalizeCompileResponse(res: SigmaCompileResponse): SigmaCompileResponse {
  const fold = (compiled: CompiledSigma, reason?: string | null, sql?: string | null) => ({
    ...compiled,
    reason: reason || compiled.reason || undefined,
    sql: sql || compiled.sql || undefined,
  });
  return {
    ...res,
    compiled: res.compiled ? fold(res.compiled, null, res.sql) : res.compiled,
    applicable: (res.applicable ?? []).map((rule) => ({
      ...rule,
      compiled: fold(rule.compiled, rule.reason, rule.sql),
    })),
  };
}

export const securitySigmaKeys = {
  catalog: (org: string) => orgKey(org, "security", "sigma", "catalog"),
  compile: (org: string, body: SigmaCompileRequest) =>
    orgKey(org, "security", "sigma", "compile", body),
  coverage: (org: string) => orgKey(org, "security", "mitre", "coverage"),
  evidence: (org: string, alertId: string, params: EvidenceParams) =>
    orgKey(org, "security", "detections", alertId, "evidence", params),
};

/** The shipped Sigma pack; fixed for the life of the server build. */
export const sigmaCatalogQuery = (org: string) =>
  queryOptions({
    queryKey: securitySigmaKeys.catalog(org),
    queryFn: async (): Promise<SigmaCatalog> => (await securitySigma.catalog(org)).data,
    staleTime: SESSION_STALE_TIME,
  });

/** A rule (or, with none named, the source's whole pack) compiled for a stream; read-only. */
export const sigmaCompileQuery = (org: string, body: SigmaCompileRequest) =>
  queryOptions({
    queryKey: securitySigmaKeys.compile(org, body),
    queryFn: async (): Promise<SigmaCompileResponse> =>
      normalizeCompileResponse((await securitySigma.compile(org, body)).data),
    staleTime: LIVE_STALE_TIME,
  });

/** ATT&CK coverage of the catalog and the org's detections, without firing counts. */
export const mitreCoverageQuery = (org: string) =>
  queryOptions({
    queryKey: securitySigmaKeys.coverage(org),
    queryFn: async (): Promise<MitreCoverage> => (await securitySigma.coverage(org)).data,
    staleTime: LIVE_STALE_TIME,
  });

/** The events behind one firing, per fired group; a firing never changes, so it is cached. */
export const detectionEvidenceQuery = (org: string, alertId: string, params: EvidenceParams) =>
  queryOptions({
    queryKey: securitySigmaKeys.evidence(org, alertId, params),
    queryFn: async (): Promise<DetectionEvidence> =>
      (await securitySigma.evidence(org, alertId, params)).data,
    staleTime: LIVE_STALE_TIME,
  });
