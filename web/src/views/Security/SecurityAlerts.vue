<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Alerts — every time a detection fired.
     These rows come from alert history, which is an immutable evaluation
     record: when a rule ran, over what window, what it found and how long it
     took. That is deliberately NOT where triage lives. Status, assignment and
     disposition belong to a case, because they are decisions a person makes
     about a group of firings rather than facts about one evaluation. Putting a
     mutable status on a history row would mean inventing a store for it and
     letting it drift from the incident that actually tracks the work. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertsService from "@/services/alerts";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { whereOfDetectionSql } from "@/utils/security/detection";
import "@/views/Security/security.scss";

const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

const { byName, siemRows, hydrating, load: loadDetections } = useSiemDetections();

// ── History ──────────────────────────────────────────────────────────────────
interface HistoryRow {
  timestamp: number;
  alert_name: string;
  status: string;
  level: string;
  actual_value: number | null;
  threshold_operator: string | null;
  start_time: number;
  end_time: number;
  error: string | null;
  is_silenced: boolean;
  evaluation_took_in_secs: number | null;
}

const history = ref<HistoryRow[]>([]);
const loading = ref(true);
const error = ref("");
const rangeMinutes = ref(1440);
const siemOnly = ref(true);
const firedOnly = ref(true);
const search = ref("");
const selected = ref<HistoryRow | null>(null);

const RANGES = [
  { label: "Last hour", value: 60 },
  { label: "Last 6 hours", value: 360 },
  { label: "Last 24 hours", value: 1440 },
  { label: "Last 7 days", value: 10080 },
  { label: "Last 30 days", value: 43200 },
];

/**
 * A firing, as opposed to an evaluation that found nothing.
 *
 * The scheduler writes a row every time it runs, so most of them are the rule
 * saying "nothing here". `level` is the field that separates the two, and it is
 * the difference between a page an analyst can use and a log of cron output.
 */
const isFiring = (row: HistoryRow) =>
  row.level !== "ok" || (row.actual_value ?? 0) > 0 || !!row.error;

async function fetchHistory() {
  if (!orgId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const end = Date.now() * 1000;
    const start = end - rangeMinutes.value * 60 * 1_000_000;
    const res = await alertsService.getHistory(orgId.value, {
      start_time: String(start),
      end_time: String(end),
      from: "0",
      size: "500",
      sort_by: "timestamp",
      sort_order: "desc",
    });
    history.value = res.data?.hits ?? [];
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Could not load alert history";
    history.value = [];
  } finally {
    loading.value = false;
  }
}

watch(rangeMinutes, () => void fetchHistory());

/** History rows joined to the detection that produced them, where there is one. */
const joined = computed(() =>
  history.value.map((row) => ({ row, detection: byName.value.get(row.alert_name) ?? null })),
);

const filtered = computed(() =>
  joined.value.filter(({ row, detection }) => {
    if (siemOnly.value && !detection) return false;
    if (firedOnly.value && !isFiring(row)) return false;
    if (!search.value.trim()) return true;
    const needle = search.value.toLowerCase();
    return (
      row.alert_name?.toLowerCase().includes(needle) ||
      (detection?.meta.techniques ?? []).some((t) => t.toLowerCase().includes(needle))
    );
  }),
);

const counts = computed(() => {
  const siem = joined.value.filter((entry) => entry.detection);
  return {
    evaluations: siem.length,
    firings: siem.filter((entry) => isFiring(entry.row)).length,
    errors: siem.filter((entry) => entry.row.error).length,
    silenced: siem.filter((entry) => entry.row.is_silenced).length,
  };
});

/** The busiest detections in the window, which is where tuning starts. */
const topDetections = computed(() => {
  const tally = new Map<string, number>();
  for (const { row, detection } of joined.value) {
    if (!detection || !isFiring(row)) continue;
    tally.set(row.alert_name, (tally.get(row.alert_name) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
});

const badgeLevel = (level: string) => (level === "informational" ? "info" : level);

function fmtTime(micros: number): string {
  if (!micros) return "—";
  return new Date(micros / 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtWindow(row: HistoryRow): string {
  if (!row.start_time || !row.end_time) return "—";
  const minutes = Math.round((row.end_time - row.start_time) / 60_000_000);
  return `${minutes}m window`;
}

/** Opens the Events page showing the rows this detection matches. */
function investigate(entry: { row: HistoryRow; detection: any }) {
  const detection = entry.detection;
  if (!detection) return;
  const where = whereOfDetectionSql(detection.alert.query_condition?.sql);
  const stream = detection.alert.stream_name;
  if (!where || !stream) return;
  router.push({
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream,
      sql_mode: "true",
      query: `SELECT * FROM "${stream}" WHERE ${where} ORDER BY _timestamp DESC`,
      from: String(entry.row.start_time),
      to: String(entry.row.end_time),
    },
  });
}

onMounted(async () => {
  await Promise.all([loadDetections(orgId.value), fetchHistory()]);
});
</script>

<template>
  <div class="sec-page">
    <div class="sec-toolbar">
      <OIcon name="notifications-active" size="sm" class="text-accent" />
      <span class="text-sm font-semibold">Alerts</span>
      <span class="text-text-tertiary text-xs">
        {{ counts.firings }} firing of {{ counts.evaluations }} evaluations
        <template v-if="hydrating">· identifying detections…</template>
      </span>
      <div class="flex-1" />
      <OSelect
        :model-value="rangeMinutes"
        :options="RANGES"
        size="sm"
        @update:model-value="rangeMinutes = Number($event)"
      />
      <OButton size="sm" variant="ghost" icon="restart-alt" @click="fetchHistory">Refresh</OButton>
    </div>

    <div class="sec-body flex flex-col overflow-hidden">
      <!-- Summary of the window -->
      <div class="border-border-default flex flex-wrap gap-3 border-b px-3 py-2">
        <div class="stat-card">
          <div class="stat-value">{{ counts.firings }}</div>
          <div class="stat-label">Firings</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ siemRows.length }}</div>
          <div class="stat-label">Detections</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ counts.errors }}</div>
          <div class="stat-label">Errored</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ counts.silenced }}</div>
          <div class="stat-label">Silenced</div>
        </div>
        <div v-if="topDetections.length" class="flex flex-1 flex-col gap-1 pl-2">
          <span class="text-text-tertiary text-2xs font-bold">Noisiest in this window</span>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="item in topDetections"
              :key="item.name"
              class="border-border-default text-2xs rounded-default border px-1.5 py-0.5"
              @click="search = item.name"
            >
              {{ item.name }} · {{ item.count }}
            </button>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="border-border-default flex items-center gap-2 border-b px-3 py-2">
        <input
          v-model="search"
          class="border-border-default text-compact rounded-default flex-1 border bg-transparent px-2 py-1 outline-none"
          placeholder="Search by detection or technique…"
        />
        <button
          class="text-2xs rounded-default px-2 py-1 font-semibold"
          :class="
            firedOnly ? 'bg-accent text-white' : 'text-text-secondary border-border-default border'
          "
          title="Hide evaluations that matched nothing"
          @click="firedOnly = !firedOnly"
        >
          Fired only
        </button>
        <button
          class="text-2xs rounded-default px-2 py-1 font-semibold"
          :class="
            siemOnly ? 'bg-accent text-white' : 'text-text-secondary border-border-default border'
          "
          title="Hide alerts that are not SIEM detections"
          @click="siemOnly = !siemOnly"
        >
          SIEM
        </button>
      </div>

      <div v-if="loading" class="text-text-secondary flex items-center gap-2 px-3 py-4 text-xs">
        <OIcon name="hourglass-empty" size="sm" />
        Loading alert history…
      </div>
      <div v-else-if="error" class="text-error flex items-center gap-2 px-3 py-4 text-xs">
        <OIcon name="error-outline" size="sm" />
        {{ error }}
      </div>
      <div
        v-else-if="!filtered.length"
        class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <OIcon name="notifications-off" size="xl" class="text-text-tertiary opacity-30" />
        <div class="text-sm font-bold">Nothing fired in this window</div>
        <div class="text-text-secondary max-w-96 text-xs leading-relaxed">
          <template v-if="!siemRows.length">
            No detections exist yet. Create one from the rule library, or from a stream on the
            Events page.
          </template>
          <template v-else>
            {{ siemRows.length }} detection{{ siemRows.length === 1 ? "" : "s" }} ran and matched
            nothing. Widen the range, or turn off "Fired only" to see the evaluations themselves.
          </template>
        </div>
      </div>

      <!-- Firings -->
      <div v-else class="flex-1 overflow-y-auto">
        <div
          v-for="entry in filtered"
          :key="`${entry.row.alert_name}-${entry.row.timestamp}`"
          class="border-border-subtle hover:bg-surface-hover flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs"
          :class="{ 'bg-surface-selected': selected === entry.row }"
          @click="selected = selected === entry.row ? null : entry.row"
        >
          <span
            :class="[
              'sev-badge shrink-0',
              `sev-${badgeLevel(entry.detection?.meta.level ?? 'medium')}`,
            ]"
          >
            {{ entry.detection?.meta.level ?? "—" }}
          </span>
          <span class="text-text-tertiary w-36 shrink-0 tabular-nums">
            {{ fmtTime(entry.row.timestamp) }}
          </span>
          <span class="text-compact flex-1 truncate font-medium">{{ entry.row.alert_name }}</span>
          <span
            v-for="t in entry.detection?.meta.techniques ?? []"
            :key="t"
            class="mitre-chip shrink-0"
          >
            {{ t }}
          </span>
          <!-- What it found and whether it was delivered are separate facts. A
               rule that matched 40 rows AND failed to notify has to show both,
               or the interesting half is hidden behind the plumbing half. -->
          <span
            v-if="entry.row.actual_value != null"
            class="text-text-secondary shrink-0 tabular-nums"
          >
            {{ entry.row.actual_value }} match{{ entry.row.actual_value === 1 ? "" : "es" }}
          </span>
          <span v-if="entry.row.is_silenced" class="status-badge status-closed shrink-0">
            silenced
          </span>
          <span
            v-if="entry.row.error"
            class="status-badge status-tp shrink-0"
            :title="entry.row.error"
          >
            not delivered
          </span>
          <span class="text-text-tertiary shrink-0">{{ fmtWindow(entry.row) }}</span>
          <OButton
            v-if="entry.detection"
            size="sm"
            variant="ghost"
            @click.stop="investigate(entry)"
          >
            Investigate
          </OButton>
        </div>
      </div>

      <!-- Detail of one firing -->
      <div
        v-if="selected"
        class="border-border-default bg-surface-panel max-h-72 shrink-0 overflow-y-auto border-t p-3"
      >
        <div class="flex items-center gap-2">
          <span class="text-compact font-bold">{{ selected.alert_name }}</span>
          <span class="text-text-tertiary text-xs">{{ fmtTime(selected.timestamp) }}</span>
          <div class="flex-1" />
          <button class="text-text-tertiary hover:text-text-primary" @click="selected = null">
            <OIcon name="close" size="sm" />
          </button>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div class="flex gap-2">
            <span class="text-text-tertiary w-28 shrink-0 font-bold">Evaluated</span>
            <span>{{ fmtTime(selected.start_time) }} → {{ fmtTime(selected.end_time) }}</span>
          </div>
          <div class="flex gap-2">
            <span class="text-text-tertiary w-28 shrink-0 font-bold">Outcome</span>
            <span>{{ selected.level }} ({{ selected.status }})</span>
          </div>
          <div class="flex gap-2">
            <span class="text-text-tertiary w-28 shrink-0 font-bold">Matches</span>
            <span class="tabular-nums">
              {{ selected.actual_value ?? "—" }}
              <template v-if="selected.threshold_operator">
                (threshold {{ selected.threshold_operator }} 1)
              </template>
            </span>
          </div>
          <div class="flex gap-2">
            <span class="text-text-tertiary w-28 shrink-0 font-bold">Took</span>
            <span>{{ selected.evaluation_took_in_secs ?? "—" }}s</span>
          </div>
          <div v-if="selected.error" class="col-span-2 flex gap-2">
            <span class="text-text-tertiary w-28 shrink-0 font-bold">Error</span>
            <!-- A delivery failure quotes the destination's response verbatim,
                 which for an HTTP endpoint is an entire error page. It is kept
                 in full because the detail matters when debugging a webhook,
                 but boxed so it cannot push the rest of the panel off screen. -->
            <span class="text-error text-2xs max-h-24 flex-1 overflow-y-auto font-mono break-words">
              {{ selected.error }}
            </span>
          </div>
        </div>

        <pre
          v-if="byName.get(selected.alert_name)?.meta.sigmaYaml"
          class="border-border-default bg-surface-muted rounded-default text-2xs mt-3 overflow-x-auto border p-3 font-mono leading-relaxed"
          >{{ byName.get(selected.alert_name)?.meta.sigmaYaml }}</pre>
      </div>
    </div>
  </div>
</template>
