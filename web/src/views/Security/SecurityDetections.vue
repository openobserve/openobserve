<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Detection rules.
     A detection here IS an OpenObserve scheduled alert: same scheduler, same
     firing history, same incident rollup. What makes it a detection is the Sigma
     rule stored in its context_attributes, which is also what runs. See
     utils/security/detection.ts for why that mapping was chosen over a parallel
     rule engine. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import { toast } from "@/lib/feedback/Toast/useToast";
import { bestMatch } from "@/utils/security/classify";
import { SOURCE_TYPE_BY_ID, sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import type { SigmaRule } from "@/utils/security/sigma";
import {
  blockedReason,
  caveat,
  compileSigmaRule,
  parseSigmaRule,
  sigmaCatalog,
} from "@/utils/security/sigma";
import { KEYWORD_FIELDS, SIGMA_FIELD_MAPS } from "@/utils/security/sigma/catalog";
import { buildDetectionAlert, detectionMetaOf } from "@/utils/security/detection";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import "@/views/Security/security.scss";

const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Rule list ────────────────────────────────────────────────────────────────
// The list and its SIEM metadata come from the shared loader; see
// composables/security/useSiemDetections.ts for why hydration is needed at all.
const {
  rows,
  siemRows,
  loading,
  hydrating,
  error,
  unchecked: notHydrated,
  load: loadRules,
  patch: patchRule,
  remove: removeRule,
} = useSiemDetections();

const filter = ref("");
const siemOnly = ref(true);
const selected = ref<any | null>(null);
const activeTab = ref<"detail" | "sigma" | "sql">("detail");

/** Severity words map onto the shared badge classes, which use `info`. */
const badgeLevel = (level: string) => (level === "informational" ? "info" : level);

const filtered = computed(() =>
  (siemOnly.value ? siemRows.value : rows.value).filter(({ alert, meta }) => {
    if (!filter.value.trim()) return true;
    const needle = filter.value.toLowerCase();
    return (
      alert.name?.toLowerCase().includes(needle) ||
      meta.techniques.some((t) => t.toLowerCase().includes(needle)) ||
      alert.stream_name?.toLowerCase().includes(needle)
    );
  }),
);

const siemCount = computed(() => siemRows.value.length);

const fetchRules = () => loadRules(orgId.value);

/**
 * Toggling asks the server first and only then updates the row.
 *
 * An optimistic flip is the wrong trade for a control that decides whether a
 * detection runs: the failure mode is a UI that says "enabled" over a rule that
 * is switched off, which is exactly the state nobody notices.
 */
async function toggleRule(entry: { alert: any }) {
  const alert = entry.alert;
  const next = !alert.enabled;
  if (!alert.id) {
    toast({ variant: "error", message: `${alert.name} has no id and cannot be toggled` });
    return;
  }
  try {
    await alertsService.toggle_state_by_alert_id(orgId.value, alert.id, next);
    patchRule(alert.id, { enabled: next });
    if (selected.value?.id === alert.id) selected.value = { ...selected.value, enabled: next };
    toast({ variant: "success", message: `${alert.name} ${next ? "enabled" : "disabled"}` });
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? "Could not change the rule state",
    });
  }
}

async function deleteRule(alert: any) {
  if (!alert.id) {
    toast({ variant: "error", message: `${alert.name} has no id and cannot be deleted` });
    return;
  }
  try {
    await alertsService.delete_by_alert_id(orgId.value, alert.id);
    removeRule(alert.id);
    if (selected.value?.id === alert.id) selected.value = null;
    toast({ variant: "success", message: `${alert.name} deleted` });
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? "Could not delete the rule" });
  }
}

function relTime(value: string | number | null | undefined): string {
  if (!value) return "Never";
  const raw = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(raw)) return "Never";
  // Alert timestamps arrive in microseconds from some endpoints, milliseconds
  // from others; both are far enough apart to tell without a flag.
  const ms = raw > 1e14 ? raw / 1000 : raw;
  const diff = Date.now() - ms;
  if (diff < 0) return "Scheduled";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Create ───────────────────────────────────────────────────────────────────
const showNew = ref(false);
const mode = ref<"catalog" | "custom">("catalog");
const catalogFilter = ref("");
const pickedRuleId = ref("");
const customYaml = ref(`title: My Detection
status: experimental
description: Detects something worth waking up for.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: CreateAccessKey
  condition: selection
level: medium
tags:
  - attack.persistence
  - attack.t1098.001`);

const streams = ref<string[]>([]);
const pickedStream = ref("");
const streamFields = ref<string[]>([]);
const destinations = ref<string[]>([]);
const pickedDestinations = ref<string[]>([]);
const period = ref(15);
const frequency = ref(15);
const silence = ref(30);
const saving = ref(false);

const catalog = computed(() => sigmaCatalog());

const catalogMatches = computed(() => {
  const needle = catalogFilter.value.trim().toLowerCase();
  if (!needle) return catalog.value;
  return catalog.value.filter(
    (rule) =>
      rule.title.toLowerCase().includes(needle) ||
      rule.techniques.some((t) => t.toLowerCase().includes(needle)) ||
      sigmaLogsourceLabel(rule.logsource).toLowerCase().includes(needle),
  );
});

/** The rule about to be saved, from whichever tab the user is on. */
const draftRule = computed<SigmaRule | null>(() => {
  if (mode.value === "catalog") {
    return catalog.value.find((rule) => rule.id === pickedRuleId.value) ?? null;
  }
  const parsed = parseSigmaRule(customYaml.value);
  return parsed.ok ? parsed.rule : null;
});

const customError = computed(() => {
  if (mode.value !== "custom") return "";
  const parsed = parseSigmaRule(customYaml.value);
  return parsed.ok ? "" : parsed.error.message;
});

/**
 * What the stream was identified as, which decides the field mapping.
 *
 * When the Events page sent us here it already classified the stream with a
 * sample row in hand, which is strictly better evidence than a schema alone, so
 * its answer is preferred over re-deciding from the field list.
 */
const presetSource = ref("");
const draftSource = computed(() => {
  if (presetSource.value) return SOURCE_TYPE_BY_ID.get(presetSource.value) ?? null;
  return streamFields.value.length ? (bestMatch(streamFields.value)?.source ?? null) : null;
});

/**
 * The draft compiled against the chosen stream.
 *
 * Recomputed on every change so the dialog can refuse to save a rule that would
 * not run, and say why, before anything is written.
 */
const draftCompiled = computed(() => {
  const rule = draftRule.value;
  if (!rule || !streamFields.value.length) return null;
  const sourceId = draftSource.value?.id ?? "";
  return compileSigmaRule(rule, {
    fieldMap: SIGMA_FIELD_MAPS[sourceId],
    availableFields: streamFields.value,
    keywordFields:
      KEYWORD_FIELDS[sourceId] ??
      ["message", "log"].filter((f) => streamFields.value.some((name) => name.toLowerCase() === f)),
  });
});

const canSave = computed(
  () =>
    !!draftRule.value &&
    !!pickedStream.value &&
    !!pickedDestinations.value.length &&
    !!draftCompiled.value?.runnable &&
    !saving.value,
);

async function loadStreams() {
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    streams.value = (res.data?.list ?? []).map((s: any) => s.name);
  } catch {
    streams.value = [];
  }
}

async function loadDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: orgId.value,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    const list = res.data?.list ?? res.data ?? [];
    destinations.value = (Array.isArray(list) ? list : []).map((d: any) => d.name);
  } catch {
    destinations.value = [];
  }
}

async function loadStreamFields(name: string) {
  if (!name) {
    streamFields.value = [];
    return;
  }
  try {
    const res = await streamService.schema(orgId.value, name, "logs");
    streamFields.value = (res.data?.schema ?? []).map((f: any) => f.name);
  } catch {
    streamFields.value = [];
  }
}

watch(pickedStream, (name, previous) => {
  // The preset belongs to the stream Events sent over. Once the user picks a
  // different one, that evidence no longer describes what is being compiled.
  if (previous !== undefined) presetSource.value = "";
  void loadStreamFields(name);
});

async function saveDetection() {
  const rule = draftRule.value;
  const compiled = draftCompiled.value;
  if (!rule || !compiled?.runnable) return;

  saving.value = true;
  try {
    const payload = buildDetectionAlert({
      rule,
      where: compiled.where,
      fields: compiled.fields,
      stream: pickedStream.value,
      destinations: pickedDestinations.value,
      sourceType: draftSource.value?.id ?? "",
      period: Number(period.value),
      frequency: Number(frequency.value),
      silence: Number(silence.value),
    });
    await alertsService.create_by_alert_id(orgId.value, payload);
    toast({ variant: "success", message: `Detection "${payload.name}" created` });
    showNew.value = false;
    await fetchRules();
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? "Could not create the detection",
    });
  } finally {
    saving.value = false;
  }
}

// ── Arriving from the Events page with a rule already chosen ────────────────
async function openFromQuery() {
  const { sigma_id: sigmaId, stream, source } = route.query;
  if (!sigmaId) return;
  mode.value = "catalog";
  pickedRuleId.value = String(sigmaId);
  if (stream) {
    pickedStream.value = String(stream);
    await loadStreamFields(String(stream));
  }
  // The Events page already classified the stream; keeping its answer avoids a
  // second, possibly different, classification from a schema alone.
  if (source && SOURCE_TYPE_BY_ID.has(String(source))) {
    presetSource.value = String(source);
  }
  showNew.value = true;
  // Consume the query so a reload does not reopen the dialog.
  void router.replace({ query: { org_identifier: orgId.value } });
}

onMounted(async () => {
  await Promise.all([fetchRules(), loadStreams(), loadDestinations()]);
  await openFromQuery();
});
</script>

<template>
  <div class="sec-page flex-row">
    <!-- Rule list -->
    <div class="border-border-default flex w-96 shrink-0 flex-col overflow-hidden border-r">
      <div class="sec-toolbar">
        <OIcon name="shield-alert-outline" size="sm" class="text-accent" />
        <span class="text-sm font-semibold">Detections</span>
        <span class="text-text-tertiary text-xs">
          {{ siemCount }} SIEM
          <template v-if="hydrating">· identifying…</template>
        </span>
        <div class="flex-1" />
        <OButton size="sm" icon="add-circle" @click="showNew = true">New detection</OButton>
      </div>

      <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <input
          v-model="filter"
          class="border-border-default text-compact text-text-primary rounded-default flex-1 border bg-transparent px-2 py-1 outline-none"
          placeholder="Search rules, streams, techniques…"
        />
        <button
          class="text-2xs rounded-default px-2 py-1 font-semibold"
          :class="
            siemOnly ? 'bg-accent text-white' : 'text-text-secondary border-border-default border'
          "
          title="Show only rules created by the SIEM"
          @click="siemOnly = !siemOnly"
        >
          SIEM
        </button>
        <button class="text-text-tertiary hover:text-text-primary p-1" @click="fetchRules">
          <OIcon name="restart-alt" size="sm" />
        </button>
      </div>

      <div v-if="loading" class="text-text-secondary flex items-center gap-2 px-3 py-4 text-xs">
        <OIcon name="hourglass-empty" size="sm" />
        Loading detection rules…
      </div>
      <div v-else-if="error" class="text-error flex items-center gap-2 px-3 py-4 text-xs">
        <OIcon name="error-outline" size="sm" />
        {{ error }}
      </div>
      <div
        v-else-if="!filtered.length"
        class="flex flex-col items-center gap-2 px-5 py-7 text-center"
      >
        <OIcon name="shield-alert-outline" size="lg" class="text-text-tertiary opacity-30" />
        <div class="text-sm font-bold">
          <template v-if="hydrating">Identifying rules…</template>
          <template v-else>{{ siemOnly ? "No detections yet" : "No rules match" }}</template>
        </div>
        <div class="text-text-secondary max-w-72 text-xs leading-relaxed">
          A detection is a Sigma rule running as a scheduled alert. Every firing lands in
          SIEM&nbsp;&rsaquo;&nbsp;Alerts and rolls up into Cases.
        </div>
        <OButton v-if="siemOnly" size="sm" icon="add-circle" @click="showNew = true">
          Create the first detection
        </OButton>
      </div>

      <div v-else class="flex-1 overflow-y-auto">
        <div v-if="notHydrated" class="text-text-tertiary text-2xs px-3 py-2 leading-relaxed">
          {{ notHydrated }} further alert{{ notHydrated === 1 ? "" : "s" }} were not checked for
          SIEM metadata. Raise the limit or filter in the Alerts page if a detection is missing
          here.
        </div>
        <div
          v-for="entry in filtered"
          :key="entry.alert.id ?? entry.alert.name"
          class="border-border-subtle hover:bg-surface-hover flex cursor-pointer flex-col gap-1.5 border-b px-3 py-2.5"
          :class="{ 'bg-surface-selected': selected === entry.alert }"
          @click="
            selected = entry.alert;
            activeTab = 'detail';
          "
        >
          <div class="flex flex-wrap items-center gap-2">
            <span :class="['sev-badge', `sev-${badgeLevel(entry.meta.level)}`]">
              {{ entry.meta.level }}
            </span>
            <span class="text-compact flex-1 truncate font-semibold">{{ entry.alert.name }}</span>
            <span
              v-if="entry.meta.isSiem"
              class="text-3xs bg-accent/12 text-accent rounded-default px-1.5 py-0.5 font-extrabold"
            >
              SIEM
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-text-tertiary text-2xs font-mono">{{ entry.alert.stream_name }}</span>
            <span v-for="t in entry.meta.techniques" :key="t" class="mitre-chip">{{ t }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="text-3xs rounded-default px-1.5 py-0.5 font-bold"
              :class="
                entry.alert.enabled
                  ? 'bg-success-subtle text-success'
                  : 'bg-surface-muted text-text-tertiary'
              "
              @click.stop="toggleRule(entry)"
            >
              {{ entry.alert.enabled ? "Enabled" : "Disabled" }}
            </button>
            <div class="flex-1" />
            <span class="text-text-tertiary text-2xs">
              {{ relTime(entry.alert.last_triggered_at ?? entry.alert.updatedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail -->
    <div v-if="selected" class="flex flex-1 flex-col overflow-hidden">
      <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span :class="['sev-badge', `sev-${badgeLevel(detectionMetaOf(selected).level)}`]">
          {{ detectionMetaOf(selected).level }}
        </span>
        <span class="text-compact flex-1 font-bold">{{ selected.name }}</span>
        <OButton size="sm" variant="ghost" icon="delete" @click="deleteRule(selected)">
          Delete
        </OButton>
        <button class="text-text-tertiary hover:text-text-primary" @click="selected = null">
          <OIcon name="close" size="sm" />
        </button>
      </div>

      <div class="border-border-default flex shrink-0 border-b">
        <button
          v-for="tab in ['detail', 'sigma', 'sql'] as const"
          :key="tab"
          class="border-b-2 px-4 py-2 text-xs font-semibold"
          :class="
            activeTab === tab
              ? 'border-accent text-text-primary'
              : 'text-text-secondary border-transparent'
          "
          @click="activeTab = tab"
        >
          {{ tab === "detail" ? "Details" : tab === "sigma" ? "Sigma rule" : "Compiled SQL" }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <template v-if="activeTab === 'detail'">
          <dl class="flex flex-col gap-2.5">
            <div class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">Stream</dt>
              <dd class="text-compact font-mono">{{ selected.stream_name }}</dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">State</dt>
              <dd class="text-compact">{{ selected.enabled ? "Enabled" : "Disabled" }}</dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">Schedule</dt>
              <dd class="text-compact">
                every {{ selected.trigger_condition?.frequency ?? "?" }}m over the last
                {{ selected.trigger_condition?.period ?? "?" }}m
              </dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">Notifies</dt>
              <dd class="text-compact">{{ (selected.destinations ?? []).join(", ") || "—" }}</dd>
            </div>
            <div v-if="detectionMetaOf(selected).logsource" class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">Logsource</dt>
              <dd class="text-compact font-mono">{{ detectionMetaOf(selected).logsource }}</dd>
            </div>
            <div v-if="detectionMetaOf(selected).techniques.length" class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">MITRE</dt>
              <dd class="flex flex-wrap gap-1">
                <span
                  v-for="t in detectionMetaOf(selected).techniques"
                  :key="t"
                  class="mitre-chip"
                  >{{ t }}</span
                >
              </dd>
            </div>
            <div v-if="selected.description" class="flex items-start gap-3">
              <dt class="text-text-tertiary text-2xs w-28 shrink-0 font-bold">Description</dt>
              <dd class="text-compact leading-relaxed">{{ selected.description }}</dd>
            </div>
          </dl>
        </template>

        <template v-else-if="activeTab === 'sigma'">
          <pre
            v-if="detectionMetaOf(selected).sigmaYaml"
            class="border-border-default bg-surface-muted text-compact rounded-surface overflow-x-auto border p-4 font-mono leading-relaxed"
            >{{ detectionMetaOf(selected).sigmaYaml }}</pre>
          <div v-else class="text-text-secondary flex items-start gap-2 text-xs leading-relaxed">
            <OIcon name="info-outline" size="sm" />
            This alert carries no Sigma rule. Alerts created outside the SIEM run the same way but
            were not written as detections.
          </div>
        </template>

        <template v-else>
          <pre
            class="border-border-default bg-surface-muted text-compact rounded-surface overflow-x-auto border p-4 font-mono leading-relaxed"
            >{{ selected.query_condition?.sql || "No SQL on this rule" }}</pre>
        </template>
      </div>
    </div>

    <div
      v-else-if="!loading"
      class="text-text-tertiary text-compact flex flex-1 flex-col items-center justify-center gap-2"
    >
      <OIcon name="shield-alert-outline" size="xl" class="opacity-30" />
      <div>Select a rule to see what it runs</div>
    </div>

    <!-- Create -->
    <ODialog
      v-model:open="showNew"
      size="xl"
      title="New detection"
      sub-title="A Sigma rule compiled to SQL and scheduled as an alert"
      primary-button-label="Create detection"
      secondary-button-label="Cancel"
      :primary-button-disabled="!canSave"
      :primary-button-loading="saving"
      data-test="siem-new-detection-dialog"
      @click:primary="saveDetection"
      @click:secondary="showNew = false"
    >
      <div class="flex flex-col gap-4">
        <!-- Source of the rule -->
        <div class="border-border-default flex gap-1 border-b">
          <button
            v-for="tab in ['catalog', 'custom'] as const"
            :key="tab"
            class="border-b-2 px-3 py-2 text-xs font-semibold"
            :class="
              mode === tab
                ? 'border-accent text-text-primary'
                : 'text-text-secondary border-transparent'
            "
            @click="mode = tab"
          >
            {{ tab === "catalog" ? `Rule library (${catalog.length})` : "Write Sigma" }}
          </button>
        </div>

        <template v-if="mode === 'catalog'">
          <input
            v-model="catalogFilter"
            class="border-border-default text-compact rounded-default border bg-transparent px-2 py-1.5 outline-none"
            placeholder="Filter by title, technique or logsource…"
          />
          <div class="border-border-default rounded-default max-h-64 overflow-y-auto border">
            <label
              v-for="rule in catalogMatches"
              :key="rule.id"
              class="border-border-subtle hover:bg-surface-hover flex cursor-pointer items-center gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <input v-model="pickedRuleId" type="radio" :value="rule.id" />
              <span :class="['sev-badge', `sev-${badgeLevel(rule.level ?? 'medium')}`]">
                {{ rule.level }}
              </span>
              <span class="text-compact flex-1 truncate">{{ rule.title }}</span>
              <span class="text-text-tertiary text-2xs font-mono">
                {{ sigmaLogsourceLabel(rule.logsource) }}
              </span>
            </label>
            <div v-if="!catalogMatches.length" class="text-text-tertiary p-4 text-center text-xs">
              No rules match that filter
            </div>
          </div>
        </template>

        <template v-else>
          <textarea
            v-model="customYaml"
            rows="14"
            spellcheck="false"
            class="border-border-default bg-surface-muted text-compact rounded-default border p-3 font-mono leading-relaxed outline-none"
          />
          <div v-if="customError" class="text-error text-xs">{{ customError }}</div>
        </template>

        <!-- Where it runs -->
        <div class="grid grid-cols-2 gap-3">
          <OSelect
            :model-value="pickedStream"
            :options="streams.map((s) => ({ label: s, value: s }))"
            label="Stream"
            placeholder="Choose a stream"
            @update:model-value="pickedStream = $event as string"
          />
          <OSelect
            :model-value="pickedDestinations"
            :options="destinations.map((d) => ({ label: d, value: d }))"
            label="Notify"
            multiple
            placeholder="Choose a destination"
            @update:model-value="pickedDestinations = $event as string[]"
          />
        </div>

        <div v-if="!destinations.length" class="text-text-secondary text-xs leading-relaxed">
          No alert destinations exist yet. The alerts API requires at least one, so create a
          destination before saving a detection. Firings are recorded in
          SIEM&nbsp;&rsaquo;&nbsp;Alerts either way.
        </div>

        <div class="grid grid-cols-3 gap-3">
          <label class="text-2xs flex flex-col gap-1 font-bold">
            <span class="text-text-tertiary">Look back (minutes)</span>
            <input
              v-model.number="period"
              type="number"
              min="1"
              class="border-border-default text-compact rounded-default border bg-transparent px-2 py-1 font-normal outline-none"
            />
          </label>
          <label class="text-2xs flex flex-col gap-1 font-bold">
            <span class="text-text-tertiary">Run every (minutes)</span>
            <input
              v-model.number="frequency"
              type="number"
              min="1"
              class="border-border-default text-compact rounded-default border bg-transparent px-2 py-1 font-normal outline-none"
            />
          </label>
          <label class="text-2xs flex flex-col gap-1 font-bold">
            <span class="text-text-tertiary">Stay quiet for (minutes)</span>
            <input
              v-model.number="silence"
              type="number"
              min="0"
              class="border-border-default text-compact rounded-default border bg-transparent px-2 py-1 font-normal outline-none"
            />
          </label>
        </div>

        <!-- Whether it will actually run, decided before anything is saved -->
        <div
          v-if="draftRule && pickedStream"
          class="rounded-default border p-3 text-xs leading-relaxed"
          :class="
            draftCompiled?.runnable
              ? 'border-success/40 bg-success-subtle'
              : 'border-warning/40 bg-warning-subtle'
          "
        >
          <div class="flex items-center gap-2 font-semibold">
            <OIcon
              :name="draftCompiled?.runnable ? 'check-circle-outline' : 'warning-outline'"
              size="xs"
            />
            <span v-if="draftCompiled?.runnable">
              Compiles against {{ pickedStream }}
              <template v-if="draftSource"> — identified as {{ draftSource.label }} </template>
            </span>
            <span v-else>Will not run on {{ pickedStream }}</span>
          </div>
          <div v-if="draftCompiled && !draftCompiled.runnable" class="mt-1">
            {{ blockedReason(draftCompiled) }}
          </div>
          <div v-else-if="draftCompiled && caveat(draftCompiled)" class="mt-1">
            {{ caveat(draftCompiled) }}
          </div>
          <pre v-if="draftCompiled?.where" class="text-2xs mt-2 overflow-x-auto font-mono">{{
            draftCompiled.where
          }}</pre>
        </div>
      </div>
    </ODialog>
  </div>
</template>
