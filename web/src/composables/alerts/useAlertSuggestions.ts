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
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import { fetchRuleHistory } from "@/composables/alerts/useThresholdSuggestion";
import type { AlertPrefillStreamCandidate } from "@/ts/interfaces/alertPrefill";
import { USER_DATA_STREAM_TYPES, isUserDataStream } from "@/utils/internalStreams";
import { intentSchemaKey, type IntentSchemas, type IntentStream } from "@/utils/alerts/intents";
import {
  buildIntentChoices,
  pickSuggestions,
  readCachedBacktest,
  runOneAtATime,
  schemaPassStreams,
  scoreSuggestion,
  suggestionRule,
  visibleIntents,
  writeCachedBacktest,
  type AlertSuggestion,
  type IntentChoice,
  type SuggestionBacktest,
} from "@/utils/alerts/startSuggestions";

const toIntentStream = (row: any, type: string): IntentStream => ({
  name: String(row?.name ?? ""),
  stream_type: String(row?.stream_type ?? type),
  stats: row?.stats,
});

/** Intents and suggestions ranked on the org's streams; `hasData` is null until the streams are read. */
export function useAlertSuggestions(initialStream?: () => AlertPrefillStreamCandidate | undefined) {
  const store = useStore();
  const { t } = useI18nTyped();
  const { getStreams, getStream } = useStreams(t);

  const loading = ref(false);
  const streams = ref<IntentStream[] | null>(null);
  // A failed type might hold the org's only streams, so an empty answer then proves nothing.
  const complete = ref(false);
  const choices = ref<IntentChoice[]>([]);

  const suggestions = computed<AlertSuggestion[]>(() => pickSuggestions(choices.value));
  const hasData = computed<boolean | null>(() => {
    if (streams.value === null) return null;
    if (streams.value.length) return true;
    return complete.value ? false : null;
  });

  const readStreams = async (): Promise<IntentStream[] | null> => {
    const lists = await Promise.all(
      USER_DATA_STREAM_TYPES.map((type) =>
        getStreams(type, false, false)
          .then((res: any) => ((res?.list ?? []) as any[]).map((row) => toIntentStream(row, type)))
          .catch(() => null),
      ),
    );
    if (lists.every((list) => list === null)) return null;
    complete.value = lists.every((list) => list !== null);
    const pinned = initialStream?.();
    return lists
      .flatMap((list) => list ?? [])
      .filter((s) => s.name && isUserDataStream(s.name, s.stream_type))
      .filter((s) => !pinned || (s.name === pinned.name && s.stream_type === pinned.type));
  };

  const readSchemas = async (candidates: IntentStream[]): Promise<IntentSchemas> => {
    const read = await Promise.all(
      candidates.map((s) =>
        getStream(s.name, s.stream_type, true)
          .then((res: any) => [intentSchemaKey(s), res?.schema ?? []] as const)
          .catch(() => null),
      ),
    );
    return Object.fromEntries(read.filter((entry) => entry !== null));
  };

  const load = async (): Promise<void> => {
    loading.value = true;
    try {
      const listed = await readStreams();
      streams.value = listed;
      if (!listed) {
        choices.value = [];
        return;
      }
      const intents = visibleIntents(store.state.zoConfig?.anomaly_detection_enabled === true);
      const schemas = await readSchemas(schemaPassStreams(intents, listed));
      choices.value = buildIntentChoices(intents, listed, schemas);
    } finally {
      loading.value = false;
    }
  };

  return { loading, hasData, choices, suggestions, load };
}

/** Back-tests a suggestion card once per org per hour, queued behind the other cards. */
export function useSuggestionBacktest() {
  const store = useStore();
  const { t } = useI18nTyped();
  const { getStream } = useStreams(t);

  const run = async (suggestion: AlertSuggestion): Promise<SuggestionBacktest | null> => {
    const rule = suggestionRule(suggestion.prefill, suggestion.schema);
    if (!rule) return null;
    const org = store.state.selectedOrganization?.identifier ?? "";
    const key = `${suggestion.key}\u0000${rule.historySql}`;
    const cached = readCachedBacktest(org, key);
    if (cached) return cached;
    return runOneAtATime(async () => {
      const queued = readCachedBacktest(org, key);
      if (queued) return queued;
      try {
        const history = await fetchRuleHistory(store, getStream, rule);
        const value = scoreSuggestion(history, rule);
        writeCachedBacktest(org, key, value);
        return value;
      } catch {
        return { state: "failed" } as const;
      }
    });
  };

  return { run };
}
