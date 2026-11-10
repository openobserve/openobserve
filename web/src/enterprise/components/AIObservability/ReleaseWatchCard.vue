<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- New version vs the previous one over each version's first 3 hours. Observation only. -->
<template>
  <div
    v-if="visible"
    class="rounded-default border-border-default bg-card-glass-bg flex flex-col gap-2 border px-3.5 py-2.5"
    data-test="release-watch-card"
  >
    <div class="flex flex-wrap items-center gap-2">
      <OIcon name="rocket-launch" size="sm" class="text-text-secondary" />
      <span class="text-compact text-text-heading font-semibold">
        {{ t("releaseWatch.title", { agent: pair!.next.name, version: pair!.next.version }) }}
      </span>
      <OBadge
        :variant="regressions ? 'error-soft' : 'success-soft'"
        size="sm"
        data-test="release-watch-verdict"
      >
        {{
          regressions
            ? t("releaseWatch.regressions", { n: regressions }, regressions)
            : t("releaseWatch.clean")
        }}
      </OBadge>
      <span class="text-2xs text-text-secondary">
        {{
          t("releaseWatch.firstSeen", {
            at: timestampToTimezoneDate(pair!.next.first_seen!, timezone, "MMM d HH:mm"),
          })
        }}
      </span>
      <span class="flex-1" />
      <OButton
        variant="outline"
        size="sm"
        data-test="release-watch-open-compare"
        @click="emit('open-compare', pair!)"
      >
        {{ t("releaseWatch.openCompare") }}
      </OButton>
      <OButton variant="ghost" size="sm" data-test="release-watch-mute" @click="mute">
        {{ t("releaseWatch.mute") }}
      </OButton>
    </div>
    <span class="text-2xs text-text-secondary">
      {{
        t("releaseWatch.compared", {
          prev: pair!.prev.version,
          before: measures!.prev.sessions,
          after: measures!.next.sessions,
        })
      }}
    </span>
    <div class="flex flex-wrap gap-4">
      <div
        v-for="m in metrics"
        :key="m.id"
        class="flex flex-col"
        :data-test="`release-watch-${m.id}`"
      >
        <span class="text-2xs text-text-secondary font-semibold">{{
          t(`releaseWatch.metrics.${m.id}`)
        }}</span>
        <span class="text-compact text-text-body font-semibold">{{ format(m.id, m.after) }}</span>
        <span
          class="text-2xs"
          :class="m.verdict === 'regressed' ? 'text-error-600' : 'text-text-secondary'"
        >
          {{
            t("releaseWatch.was", {
              value: format(m.id, m.before),
              verdict: t(`releaseWatch.verdicts.${m.verdict}`),
            })
          }}
        </span>
      </div>
    </div>
    <span
      v-if="introduced.length"
      class="text-2xs text-text-secondary"
      data-test="release-watch-introduced"
    >
      {{
        t(
          "releaseWatch.introduced",
          { cls: introduced[0].cls, n: introduced[0].traces, prev: pair!.prev.version },
          introduced[0].traces,
        )
      }}
    </span>
  </div>
  <div
    v-else-if="mutedVisible"
    class="text-2xs text-text-secondary flex items-center gap-2"
    data-test="release-watch-muted"
  >
    <OIcon name="rocket-launch" size="sm" />
    <span>{{
      t("releaseWatch.muted", { agent: pair!.next.name, version: pair!.next.version })
    }}</span>
    <OButton variant="ghost" size="sm" data-test="release-watch-unmute" @click="unmute">
      {{ t("releaseWatch.unmute") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useStreams from "@/composables/useStreams";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import { PARENT_SPAN_FIELD } from "@/plugins/traces/config/llmInsightsPanels";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import { formatCost } from "@/utils/llmUtils";
import { timestampToTimezoneDate } from "@/utils/timezone";
import {
  WATCH_MIN_SESSIONS,
  WATCH_WINDOW_US,
  compareWindows,
  errorClass,
  introducedClasses,
  toMeasures,
  versionFailuresSql,
  versionWindowSql,
  watchPair,
  releaseWatchMuteKey,
  type WatchMetric,
  type WindowMeasures,
} from "./releaseWatch";

const props = defineProps<{ variants: GenAiAgentListItem[]; stream: string }>();
const emit = defineEmits<{
  (e: "open-compare", pair: { next: GenAiAgentListItem; prev: GenAiAgentListItem }): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const { executeQuery } = useLLMStreamQuery();
const timezone = computed(() => store.state.timezone || "UTC");

const pair = computed(() => watchPair(props.variants));
const measures = ref<{ prev: WindowMeasures; next: WindowMeasures } | null>(null);
const metrics = ref<WatchMetric[]>([]);
const introduced = ref<Array<{ cls: string; traces: number }>>([]);
const muted = ref(false);
let seq = 0;

const muteKey = () =>
  pair.value
    ? releaseWatchMuteKey(
        store.state.selectedOrganization?.identifier ?? "",
        props.stream,
        pair.value.next,
      )
    : "";
const regressions = computed(() => metrics.value.filter((m) => m.verdict === "regressed").length);
const shown = computed(
  () => !!pair.value && !!measures.value && measures.value.next.sessions >= WATCH_MIN_SESSIONS,
);
const visible = computed(() => shown.value && !muted.value);
// A muted release keeps a one-line note with Unmute, so the mute can be undone.
const mutedVisible = computed(() => shown.value && muted.value);

function format(id: WatchMetric["id"], v: number) {
  if (id === "failureRate") return raw(`${v.toFixed(1)}%`);
  if (id === "costPerSession") return raw(`$${formatCost(v)}`);
  return raw(formatTimeWithSuffix(v));
}

function mute() {
  muted.value = true;
  try {
    localStorage.setItem(muteKey(), "1");
  } catch {
    // Storage unavailable: the mute lasts for this view.
  }
}

function unmute() {
  muted.value = false;
  try {
    localStorage.removeItem(muteKey());
  } catch {
    // Storage unavailable: nothing was stored.
  }
}

// Each version's first WATCH_WINDOW_US, capped at now.
const windowOf = (v: GenAiAgentListItem) => {
  const start = v.first_seen ?? 0;
  return { start, end: Math.min(start + WATCH_WINDOW_US, Date.now() * 1000) };
};

async function load() {
  const p = pair.value;
  measures.value = null;
  if (!p || !props.stream) return;
  try {
    muted.value = localStorage.getItem(muteKey()) === "1";
  } catch {
    muted.value = false;
  }
  const mine = ++seq;
  const wp = windowOf(p.prev);
  const wn = windowOf(p.next);
  const schema = await getStream(props.stream, "traces", true).catch(() => null);
  const fields: string[] = (schema?.schema ?? []).map((f: any) => f.name);
  const hasMsg = fields.includes("status_message");
  const hasParent = fields.includes(PARENT_SPAN_FIELD);
  const run = (sql: string, w: { start: number; end: number }) =>
    sql
      ? (executeQuery(sql, w.start, w.end).catch(() => []) as Promise<any[]>)
      : Promise.resolve([]);
  const [prevRow, nextRow, prevMsgs, nextMsgs] = await Promise.all([
    run(versionWindowSql(props.stream, p.prev, hasParent), wp),
    run(versionWindowSql(props.stream, p.next, hasParent), wn),
    run(versionFailuresSql(props.stream, p.prev, hasMsg), wp),
    run(versionFailuresSql(props.stream, p.next, hasMsg), wn),
  ]);
  if (mine !== seq) return;
  measures.value = { prev: toMeasures(prevRow[0]), next: toMeasures(nextRow[0]) };
  metrics.value = compareWindows(measures.value.prev, measures.value.next);
  introduced.value = introducedClasses(
    prevMsgs.map((r) => String(r.msg ?? "")),
    nextMsgs.map((r) => String(r.msg ?? "")),
    errorClass,
  );
}

// Keyed by agent and env too, since another pair can carry the same versions.
watch(
  () => {
    const p = pair.value;
    return JSON.stringify([
      p?.next.name,
      p?.next.env,
      p?.next.version,
      p?.prev.name,
      p?.prev.env,
      p?.prev.version,
      props.stream,
      store.state.selectedOrganization?.identifier,
    ]);
  },
  load,
  { immediate: true },
);
</script>
