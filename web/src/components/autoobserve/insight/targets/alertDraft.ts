// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { AlertBuildOptions, AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { warn } from "@/utils/alerts/alertPrefill";
import type { ServiceScope } from "@/utils/alerts/prefill/fromAutoObserve";
import { readStreamFields } from "../bulk/useBulkReview";
import { measureBaseline, type BaselineRequest } from "./baseline";
import { checkScopeMatch } from "./scopeMatch";

/** The usual level a draft's threshold is suggested from, or the threshold the user typed. */
export interface DraftLevel {
  usual: number | null;
  threshold: number | null;
}

/** A single-alert draft rebuilt on its stream's fields when clicked, so its filters match what the stream holds. */
export interface AlertDraft {
  scope: ServiceScope;
  build: (scope: ServiceScope, level?: DraftLevel) => AlertPrefill | null;
  /** The usual level's query, for a draft whose threshold comes from it. */
  measure?: (scope: ServiceScope) => BaselineRequest | null;
}

/** The resolved draft, and the rebuild the dialog calls with the threshold the user types. */
export interface ResolvedDraft {
  prefill: AlertPrefill;
  rebuild?: (options?: AlertBuildOptions) => AlertPrefill;
}

const blocked = (
  prefill: AlertPrefill,
  key: string,
  params: Record<string, string>,
): AlertPrefill => ({
  ...prefill,
  warnings: [...prefill.warnings, warn(key, "blocking", params)],
});

/** The Add alert target for a draft; its card prefill is provisional until the click reads the fields. */
export const draftTarget = (
  scope: ServiceScope,
  build: AlertDraft["build"],
  folder: string,
  measure?: AlertDraft["measure"],
): { type: "create_alert"; prefill: AlertPrefill; folder: string; draft: AlertDraft } | null => {
  const prefill = build(scope);
  if (!prefill || prefill.warnings.some((w) => w.level === "blocking")) return null;
  return {
    type: "create_alert",
    prefill,
    folder,
    draft: { scope, build, ...(measure ? { measure } : {}) },
  };
};

/** The draft built on its stream's fields and, when it needs one, its measured usual level; a red reason blocks Save when the fields can't be read or used. */
export const resolveDraft = async (
  org: string,
  draft: AlertDraft,
  provisional: AlertPrefill,
  read: typeof readStreamFields = readStreamFields,
): Promise<ResolvedDraft> => {
  const stream = draft.scope.stream.name;
  const fields = await read(org, draft.scope.stream);
  if (!fields) return { prefill: blocked(provisional, "autoobserve.schemaUnread", { stream }) };
  const scope = { ...draft.scope, schema: fields.names, fieldTypes: fields.types };
  if ((await checkScopeMatch(org, scope)) === "none") {
    const params = { stream, service: draft.scope.label ?? draft.scope.service };
    return { prefill: blocked(provisional, "autoobserve.noMatch", params) };
  }
  const request = draft.measure?.(scope) ?? null;
  const usual = request ? await measureBaseline(org, request) : null;
  const build = (threshold: number | null): AlertPrefill =>
    (request ? draft.build(scope, { usual, threshold }) : draft.build(scope)) ??
    blocked(provisional, "autoobserve.noDraft", { stream });
  return { prefill: build(null), rebuild: (o) => build(o?.threshold ?? null) };
};
