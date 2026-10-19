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

import { computed, ref } from "vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import { IDENTITY_FIELDS } from "@/utils/rum/productAnalyticsQueries";
import {
  exclusionBanner,
  uaSuggestions,
  type SessionRule,
  type UaSuggestionRow,
} from "@/utils/rum/productAnalyticsModel";

export interface ExclusionSuggestion {
  value: string;
  sessions: number;
  rule: SessionRule;
}

/** Likely-bot and identity suggestions that pass the banner threshold, shared by Overview and the drawer. */
export default function useExclusionSuggestions() {
  const pa = useProductAnalytics();
  const uaRows = ref<{ app: string; rows: UaSuggestionRow[] }>({ app: "", rows: [] });

  // The user-agent query names both fields, and a query naming an absent field fails as a whole.
  const hasUaFields = computed(
    () =>
      !!pa.schema.value.user_agent_user_agent_family && !!pa.schema.value.user_agent_device_family,
  );

  const loadUa = async () => {
    if (!hasUaFields.value || !pa.state.app) return;
    const app = pa.state.app;
    const res = await pa.loadUaSuggestions();
    if (res.status === "ok") uaRows.value = { app, rows: res.rows };
  };

  const sessions = computed(() => pa.summary.value?.sessions ?? 0);

  const ua = computed<ExclusionSuggestion[]>(() => {
    const ex = pa.scope.value.exclusions;
    if (!ex || uaRows.value.app !== pa.state.app) return [];
    return uaSuggestions(uaRows.value.rows, ex)
      .filter((r) => exclusionBanner([r], sessions.value, undefined))
      .map((r) => ({
        value: r.family,
        sessions: r.sessions,
        rule: { field: "user_agent_user_agent_family", op: "in", values: [r.family] },
      }));
  });

  // The dominant value can move identity to another field, so every field with a top row is checked.
  const identity = computed<ExclusionSuggestion | null>(() => {
    const resolved = pa.identity.value?.field;
    const fields = resolved ? [resolved, ...IDENTITY_FIELDS] : IDENTITY_FIELDS;
    for (const field of fields) {
      const top = pa.identityTops.value[field]?.[0];
      if (!top || !exclusionBanner([], sessions.value, top)) continue;
      return {
        value: String(top.u),
        sessions: Number(top.s),
        rule: { field, op: "eq", values: [String(top.u)] },
      };
    }
    return null;
  });

  const banner = computed<"warning" | "info" | null>(() =>
    ua.value.length ? "warning" : identity.value ? "info" : null,
  );

  return { loadUa, ua, identity, banner };
}
