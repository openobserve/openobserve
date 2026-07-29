<!-- Copyright 2026 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<script setup lang="ts">
/**
 * The evidence panel — what the browser did while the journey ran.
 *
 * Reads the BUNDLE, not `evidence_by_step`. That field is an anomaly index:
 * `summarise()` emits a row only for a step that had a console error, a page
 * error, a failed request or a non-2xx response. A run whose network was healthy
 * carries an empty index while the bundle holds every event — so on the most
 * common failure (a locator that never matched) the index says "nothing to
 * report" and the bundle says what the page was actually doing.
 *
 * Per attempt: each attempt uploads its own bundle, attempt 0 at the bare key
 * and retries at `attempt-N-`. Showing one under another's label is a real
 * error, not a cosmetic one.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  foldEvidenceBundle,
  parseEvidenceNdjson,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const props = defineProps<{
  /** Object-storage key of the selected attempt's bundle. Null when none exists. */
  evidenceKey: string | null;
  /** Resolves a key to a fetchable URL. Already presigned for every attempt. */
  resolveUrl: (key: string) => string;
  /** step_id -> definition, for naming the step on each row. */
  stepDefs: Map<string, { name: string; selector: string | null }>;
  /** `evidence_truncated` from the record. */
  recordTruncated?: boolean;
  /** Whether capture is switched off for this check, vs merely not kept. */
  captureOff?: boolean;
  /** Whether the run passed — evidence is retained for failures by default. */
  runPassed?: boolean;
}>();

const { t } = useI18n();

type Filter = "all" | "consoleErrors" | "pageErrors" | "requestsFailed" | "nonNon2xx";

const loading = ref(false);
const loadError = ref<string | null>(null);
const events = ref<EvidenceEvent[]>([]);
const fetched = ref(false);
const filter = ref<Filter>("all");
const firstPartyOnly = ref(false);
const expanded = ref(new Set<number>());

/**
 * Fetched on demand, not with the record: the bundle runs to 256 KB at the cap
 * and most users never open this tab.
 */
async function load() {
  if (!props.evidenceKey) return;
  loading.value = true;
  loadError.value = null;
  try {
    const res = await fetch(props.resolveUrl(props.evidenceKey));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    events.value = parseEvidenceNdjson(await res.text());
    fetched.value = true;
  } catch (e: any) {
    // Never an empty list on failure — "the fetch broke" and "the run was quiet"
    // are different findings and must not render the same.
    loadError.value = e?.message ?? String(e);
    events.value = [];
  } finally {
    loading.value = false;
  }
}

// Switching attempts changes the key; refetch that attempt's own bundle.
watch(
  () => props.evidenceKey,
  () => {
    fetched.value = false;
    events.value = [];
    loadError.value = null;
    if (props.evidenceKey) load();
  },
  { immediate: true },
);

const bundle = computed(() =>
  foldEvidenceBundle(events.value, props.stepDefs, props.recordTruncated ?? false),
);

/**
 * Grouped by kind, so the labels come from one place.
 *
 * Severity order, not volume order: page errors before a wall of 200s.
 */
const GROUP_LABEL: Record<string, string> = {
  pageErrors: "synthetics.evidence.groupPageErrors",
  requestsFailed: "synthetics.evidence.groupFailedReq",
  console: "synthetics.evidence.groupConsole",
  network: "synthetics.evidence.groupNetwork",
};

function matches(e: EvidenceEvent): boolean {
  if (firstPartyOnly.value && !e.firstParty) return false;
  switch (filter.value) {
    case "consoleErrors":
      return e.kind === "console" && e.level === "error";
    case "pageErrors":
      return e.kind === "pageerror" || e.kind === "crash";
    case "requestsFailed":
      return e.kind === "requestfailed";
    case "nonNon2xx":
      return e.kind === "response" && (e.status ?? 0) >= 400;
    default:
      return true;
  }
}

/** Groups after filtering. An emptied group disappears — unlike a zero-count
 *  chip, an empty section header carries no information. */
const visibleGroups = computed(() =>
  bundle.value.groups
    .map((g) => ({ ...g, events: g.events.filter(matches) }))
    .filter((g) => g.events.length > 0),
);

const chips = computed(() => {
  const c = bundle.value.counts;
  return [
    { key: "all" as Filter, label: t("synthetics.evidence.filterAll"), count: c.all },
    { key: "consoleErrors" as Filter, label: t("synthetics.evidence.filterConsole"), count: c.consoleErrors },
    { key: "pageErrors" as Filter, label: t("synthetics.evidence.filterPageErrors"), count: c.pageErrors },
    { key: "nonNon2xx" as Filter, label: t("synthetics.evidence.filterNon2xx"), count: c.nonNon2xx },
    { key: "requestsFailed" as Filter, label: t("synthetics.evidence.filterFailedReq"), count: c.requestsFailed },
  ];
});

/** Truncate from the LEFT: the host repeats on every row, the path is what differs. */
function shortUrl(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return url.length > 70 ? `…${url.slice(-70)}` : url;
  }
}

function statusClass(e: EvidenceEvent): string {
  if (e.kind === "requestfailed" || e.kind === "crash" || e.kind === "pageerror")
    return "text-status-error-text";
  if (e.kind === "console") return e.level === "error" ? "text-status-error-text" : "text-text-secondary";
  const s = e.status ?? 0;
  if (s >= 500) return "text-status-error-text";
  if (s >= 400) return "text-status-warning-text";
  if (s >= 300) return "text-text-secondary";
  return "text-text-body";
}

function toggle(i: number) {
  const next = new Set(expanded.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  expanded.value = next;
}

const downloadUrl = computed(() =>
  props.evidenceKey ? props.resolveUrl(props.evidenceKey) : "",
);
</script>

<template>
  <div class="flex flex-col gap-3 p-3" data-test="synthetics-evidence-panel">
    <!-- ── Empty states. All four are distinct; today they all look like nothing. -->
    <div
      v-if="!evidenceKey"
      class="text-text-secondary text-sm"
      data-test="synthetics-evidence-empty"
    >
      <template v-if="captureOff">{{ t("synthetics.evidence.captureOff") }}</template>
      <template v-else-if="runPassed">{{ t("synthetics.evidence.failuresOnly") }}</template>
      <template v-else>{{ t("synthetics.evidence.none") }}</template>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-text-body text-sm">
          {{ t("synthetics.evidence.title", { count: bundle.counts.all }) }}
        </span>
        <!-- Named for what it is: NDJSON, not JSON. A JSON pane cannot parse it. -->
        <a
          :href="downloadUrl"
          download
          class="text-text-secondary hover:text-text-body flex items-center gap-1 text-xs"
          data-test="synthetics-evidence-download"
        >
          <OIcon name="download" size="xs" />
          evidence.ndjson
        </a>
      </div>

      <div v-if="loading" class="flex flex-col gap-2" data-test="synthetics-evidence-loading">
        <OSkeleton v-for="i in 4" :key="i" type="text" class="h-4 w-full" />
      </div>

      <!-- A failed fetch is reported, never rendered as an empty run. -->
      <div
        v-else-if="loadError"
        class="rounded-default border-status-error-text/30 flex items-center justify-between gap-2 border p-2 text-xs"
        role="alert"
        data-test="synthetics-evidence-error"
      >
        <span class="text-status-error-text">
          {{ t("synthetics.evidence.loadFailed", { error: loadError }) }}
        </span>
        <button type="button" class="text-text-body underline" @click="load()">
          {{ t("synthetics.evidence.retry") }}
        </button>
      </div>

      <template v-else>
        <!-- X-8.2: reduced fidelity is reported. A silently short list reads as a
             quiet run. -->
        <div
          v-if="bundle.truncated"
          class="rounded-default border-status-warning-text/30 border p-2 text-xs"
          data-test="synthetics-evidence-truncated"
        >
          <OIcon name="warning" size="xs" class="text-status-warning-text mr-1" />
          {{ t("synthetics.evidence.truncated") }}
        </div>

        <!-- Chips keep their counts and stay visible at zero: a hidden zero is
             indistinguishable from a chip that does not exist, and "no console
             errors" is information. -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="c in chips"
            :key="c.key"
            type="button"
            class="rounded-default border-border-default border px-2 py-0.5 text-xs"
            :class="[
              filter === c.key ? 'bg-surface-raised text-text-body' : 'text-text-secondary',
              c.count === 0 && c.key !== 'all' ? 'opacity-50' : '',
            ]"
            :data-test="`synthetics-evidence-chip-${c.key}`"
            @click="filter = c.key"
          >
            {{ c.label }} {{ c.count }}
          </button>
          <label class="text-text-secondary ml-2 flex items-center gap-1 text-xs">
            <input v-model="firstPartyOnly" type="checkbox" data-test="synthetics-evidence-first-party" />
            {{ t("synthetics.evidence.firstPartyOnly") }}
          </label>
        </div>

        <div v-if="!bundle.counts.all" class="text-text-secondary text-sm">
          {{ t("synthetics.evidence.noEvents") }}
        </div>

        <!-- Grouped by kind. Step attribution moved onto the row: a live
             158-event bundle had only two distinct step_ids, so grouping by step
             produced one section of 136 and told the reader nothing. -->
        <div v-for="g in visibleGroups" :key="g.kind" class="flex flex-col gap-1">
          <div
            class="border-border-default flex items-center gap-2 border-b pb-1 text-xs"
            :class="g.hasAnomaly ? 'text-status-error-text' : 'text-text-secondary'"
            :data-test="`synthetics-evidence-group-${g.kind}`"
          >
            <OIcon v-if="g.hasAnomaly" name="warning" size="xs" />
            <span>{{ t(GROUP_LABEL[g.kind]) }}</span>
            <span class="text-text-secondary">{{ g.events.length }}</span>
          </div>

          <div
            v-for="(e, i) in g.events"
            :key="`${g.kind}-${i}`"
            class="hover:bg-surface-raised flex items-start gap-2 rounded px-1 py-0.5 font-mono text-xs"
            :class="e.firstParty ? '' : 'opacity-60'"
          >
            <span class="w-10 shrink-0 text-right" :class="statusClass(e)">
              {{ e.kind === "response" ? (e.status ?? "—") : e.kind === "requestfailed" ? "—" : "" }}
            </span>
            <span class="text-text-secondary w-12 shrink-0">{{ e.method ?? e.level ?? "" }}</span>
            <span class="min-w-0 flex-1 truncate" :title="e.url ?? e.text ?? e.message ?? ''">
              {{ shortUrl(e.url) || e.text || e.message || e.kind }}
            </span>
            <!-- Which step this belongs to. Attribution kept, just not as the
                 grouping axis. -->
            <span
              class="text-text-secondary w-40 shrink-0 truncate"
              :title="e.stepName ?? ''"
              data-test="synthetics-evidence-row-step"
            >
              {{ e.stepName ?? t("synthetics.evidence.unattributed") }}
            </span>
            <span class="text-text-secondary w-14 shrink-0 text-right">
              {{ e.durationMs != null ? `${e.durationMs}ms` : "" }}
            </span>
            <button
              v-if="e.stack"
              type="button"
              class="text-text-secondary shrink-0 underline"
              @click="toggle(i)"
            >
              {{ t("synthetics.evidence.stack") }}
            </button>
          </div>
        </div>

      </template>
    </template>
  </div>
</template>
