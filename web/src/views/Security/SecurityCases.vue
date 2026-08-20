<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Cases — the SOC's working set.
     A case is an observability incident. That is not a shortcut: an incident
     already is what a case needs to be — a group of correlated firings with a
     status, an owner, a severity, a timeline and a comment thread. Building a
     separate case store would duplicate all of it and then disagree with it the
     first time a detection fired into both.
     What changes here is the presentation, not the record. A SOC does not read
     "P1 acknowledged"; it reads severity by what the detections found, and it
     needs the contributing detections and their ATT&CK coverage in front of it.
     Status vocabulary is translated at the edge and mapped straight back, so
     the same incident is legible in either product. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import incidentsService, { type Incident, type IncidentWithAlerts } from "@/services/incidents";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { toast } from "@/lib/feedback/Toast/useToast";
import "@/views/Security/security.scss";

const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

const { byName, load: loadDetections } = useSiemDetections();

// ── The SOC's words for an incident's state ─────────────────────────────────
// Left is what an analyst says, right is what the API stores. The mapping is
// total in both directions so nothing is lost by looking at it here.
const STATUS_LABEL: Record<string, string> = {
  open: "New",
  acknowledged: "Investigating",
  resolved: "Closed",
};
const STATUS_CLASS: Record<string, string> = {
  open: "status-open",
  acknowledged: "status-ack",
  resolved: "status-closed",
};
/** Incident severity is P1..P4; a SOC reads a word, not a priority code. */
const SEVERITY_LABEL: Record<string, string> = {
  P1: "critical",
  P2: "high",
  P3: "medium",
  P4: "low",
};
const severityBadge = (severity: string) => `sev-${SEVERITY_LABEL[severity] ?? "medium"}`;

// ── List ─────────────────────────────────────────────────────────────────────
const cases = ref<Incident[]>([]);
const loading = ref(true);
const error = ref("");
/** True when the deployment has no incident correlation at all. */
const unsupported = ref(false);
const statusFilter = ref("");
const search = ref("");

const STATUSES = [
  { label: "All states", value: "" },
  { label: "New", value: "open" },
  { label: "Investigating", value: "acknowledged" },
  { label: "Closed", value: "resolved" },
];

async function fetchCases() {
  if (!orgId.value) return;
  loading.value = true;
  error.value = "";
  unsupported.value = false;
  try {
    const res = await incidentsService.list(
      orgId.value,
      statusFilter.value || undefined,
      100,
      0,
      search.value.trim() || undefined,
    );
    cases.value = res.data?.incidents ?? [];
  } catch (e: any) {
    // A build without incident correlation answers "Not Supported" rather than
    // failing; that is a different thing from a broken request and is said so.
    if (e?.response?.status === 403) unsupported.value = true;
    else error.value = e?.response?.data?.message ?? e?.message ?? "Could not load cases";
    cases.value = [];
  } finally {
    loading.value = false;
  }
}

watch(statusFilter, () => void fetchCases());

const counts = computed(() => ({
  open: cases.value.filter((c) => c.status === "open").length,
  acknowledged: cases.value.filter((c) => c.status === "acknowledged").length,
  resolved: cases.value.filter((c) => c.status === "resolved").length,
}));

// ── One case ─────────────────────────────────────────────────────────────────
const selected = ref<IncidentWithAlerts | null>(null);
const detailLoading = ref(false);
const comment = ref("");
const posting = ref(false);

async function openCase(incident: Incident) {
  detailLoading.value = true;
  selected.value = null;
  try {
    const res = await incidentsService.get(orgId.value, incident.id);
    selected.value = res.data;
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? "Could not open the case" });
  } finally {
    detailLoading.value = false;
  }
}

async function setStatus(status: "open" | "acknowledged" | "resolved") {
  const current = selected.value;
  if (!current) return;
  try {
    await incidentsService.updateStatus(orgId.value, current.id, status);
    selected.value = { ...current, status };
    const row = cases.value.find((c) => c.id === current.id);
    if (row) row.status = status;
    toast({ variant: "success", message: `Case marked ${STATUS_LABEL[status]}` });
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? "Could not update the case",
    });
  }
}

async function postComment() {
  const current = selected.value;
  if (!current || !comment.value.trim()) return;
  posting.value = true;
  try {
    await incidentsService.postComment(orgId.value, current.id, comment.value.trim());
    comment.value = "";
    toast({ variant: "success", message: "Comment added" });
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? "Could not add the comment" });
  } finally {
    posting.value = false;
  }
}

/**
 * The detections behind a case, deduplicated.
 *
 * An incident groups many firings, usually several from the same rule. What the
 * analyst needs is which rules are involved and how often, not a list with the
 * same name forty times.
 */
const contributing = computed(() => {
  const tally = new Map<string, { name: string; count: number; techniques: string[] }>();
  for (const alert of selected.value?.alerts ?? []) {
    const existing = tally.get(alert.alert_name);
    if (existing) {
      existing.count += 1;
      continue;
    }
    tally.set(alert.alert_name, {
      name: alert.alert_name,
      count: 1,
      techniques: byName.value.get(alert.alert_name)?.meta.techniques ?? [],
    });
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
});

/** Every ATT&CK technique the case touches, which is its coverage at a glance. */
const caseTechniques = computed(() => {
  const all = new Set<string>();
  for (const entry of contributing.value) entry.techniques.forEach((t) => all.add(t));
  return [...all].sort();
});

function fmtTime(micros: number | undefined): string {
  if (!micros) return "—";
  const ms = micros > 1e14 ? micros / 1000 : micros;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function investigate(name: string) {
  const detection = byName.value.get(name);
  const stream = detection?.alert.stream_name;
  if (!stream) return;
  router.push({
    path: "/security/events",
    query: { org_identifier: orgId.value, stream },
  });
}

onMounted(async () => {
  await Promise.all([loadDetections(orgId.value), fetchCases()]);
});
</script>

<template>
  <div class="sec-page">
    <div class="sec-toolbar">
      <OIcon name="folder-open" size="sm" class="text-accent" />
      <span class="text-sm font-semibold">Cases</span>
      <span class="text-text-tertiary text-xs">
        {{ counts.open }} new · {{ counts.acknowledged }} investigating ·
        {{ counts.resolved }} closed
      </span>
      <div class="flex-1" />
      <OSelect
        :model-value="statusFilter"
        :options="STATUSES"
        size="sm"
        @update:model-value="statusFilter = String($event ?? '')"
      />
      <OButton size="sm" variant="ghost" icon="restart-alt" @click="fetchCases">Refresh</OButton>
    </div>

    <div class="sec-body flex flex-row overflow-hidden">
      <!-- Queue -->
      <div class="border-border-default flex w-96 shrink-0 flex-col overflow-hidden border-r">
        <div class="border-border-default shrink-0 border-b px-3 py-2">
          <input
            v-model="search"
            class="border-border-default text-compact rounded-default w-full border bg-transparent px-2 py-1 outline-none"
            placeholder="Search cases…"
            @keyup.enter="fetchCases"
          />
        </div>

        <div v-if="loading" class="text-text-secondary flex items-center gap-2 px-3 py-4 text-xs">
          <OIcon name="hourglass-empty" size="sm" />
          Loading cases…
        </div>

        <!-- Not a failure: this build simply has no correlation engine. Saying
             so is more useful than an empty list that looks like a quiet day. -->
        <div v-else-if="unsupported" class="flex flex-col items-center gap-2 px-5 py-7 text-center">
          <OIcon name="info-outline" size="lg" class="text-text-tertiary opacity-30" />
          <div class="text-sm font-bold">Case correlation is not enabled</div>
          <div class="text-text-secondary text-xs leading-relaxed">
            Cases group related detection firings automatically, which requires the incidents
            feature. Every firing is still recorded individually in SIEM&nbsp;&rsaquo;&nbsp;Alerts.
          </div>
        </div>

        <div v-else-if="error" class="text-error flex items-center gap-2 px-3 py-4 text-xs">
          <OIcon name="error-outline" size="sm" />
          {{ error }}
        </div>

        <div
          v-else-if="!cases.length"
          class="flex flex-col items-center gap-2 px-5 py-7 text-center"
        >
          <OIcon name="folder-open" size="lg" class="text-text-tertiary opacity-30" />
          <div class="text-sm font-bold">No open cases</div>
          <div class="text-text-secondary text-xs leading-relaxed">
            A case opens when detections fire and correlate. Nothing has correlated in this
            organization yet.
          </div>
        </div>

        <div v-else class="flex-1 overflow-y-auto">
          <div
            v-for="item in cases"
            :key="item.id"
            class="border-border-subtle hover:bg-surface-hover flex cursor-pointer flex-col gap-1.5 border-b px-3 py-2.5"
            :class="{ 'bg-surface-selected': selected?.id === item.id }"
            @click="openCase(item)"
          >
            <div class="flex items-center gap-2">
              <span :class="['sev-badge', severityBadge(item.severity)]">
                {{ SEVERITY_LABEL[item.severity] ?? item.severity }}
              </span>
              <span class="text-compact flex-1 truncate font-semibold">
                {{ item.title || `Case ${item.id.slice(0, 8)}` }}
              </span>
              <span :class="['status-badge', STATUS_CLASS[item.status]]">
                {{ STATUS_LABEL[item.status] ?? item.status }}
              </span>
            </div>
            <div class="text-text-tertiary text-2xs flex items-center gap-2">
              <span>{{ item.alert_count }} firing{{ item.alert_count === 1 ? "" : "s" }}</span>
              <span>·</span>
              <span>{{ fmtTime(item.first_alert_at) }} → {{ fmtTime(item.last_alert_at) }}</span>
              <div class="flex-1" />
              <span v-if="item.assigned_to">{{ item.assigned_to }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Case detail -->
      <div
        v-if="detailLoading"
        class="text-text-secondary flex flex-1 items-center justify-center gap-2 text-xs"
      >
        <OIcon name="hourglass-empty" size="sm" />
        Opening case…
      </div>

      <div v-else-if="selected" class="flex flex-1 flex-col overflow-hidden">
        <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <span :class="['sev-badge', severityBadge(selected.severity)]">
            {{ SEVERITY_LABEL[selected.severity] ?? selected.severity }}
          </span>
          <span class="text-compact flex-1 truncate font-bold">
            {{ selected.title || `Case ${selected.id.slice(0, 8)}` }}
          </span>
          <OButton
            v-for="next in ['open', 'acknowledged', 'resolved'] as const"
            :key="next"
            size="sm"
            :variant="selected.status === next ? 'primary' : 'outline'"
            @click="setStatus(next)"
          >
            {{ STATUS_LABEL[next] }}
          </OButton>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- What the case is made of -->
          <div class="flex flex-wrap gap-3">
            <div class="stat-card">
              <div class="stat-value">{{ selected.alert_count }}</div>
              <div class="stat-label">Firings</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ contributing.length }}</div>
              <div class="stat-label">Detections</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ caseTechniques.length }}</div>
              <div class="stat-label">Techniques</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ fmtTime(selected.first_alert_at) }}</div>
              <div class="stat-label">First seen</div>
            </div>
          </div>

          <div v-if="caseTechniques.length" class="mt-4">
            <div class="text-text-tertiary text-2xs font-bold">ATT&amp;CK coverage</div>
            <div class="mt-1 flex flex-wrap gap-1">
              <span v-for="t in caseTechniques" :key="t" class="mitre-chip">{{ t }}</span>
            </div>
          </div>

          <!-- Which rules put it here -->
          <div class="mt-4">
            <div class="text-text-tertiary text-2xs font-bold">Contributing detections</div>
            <div class="border-border-default rounded-default mt-1 border">
              <div
                v-for="entry in contributing"
                :key="entry.name"
                class="border-border-subtle flex items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0"
              >
                <span class="text-compact flex-1 truncate">{{ entry.name }}</span>
                <span v-for="t in entry.techniques" :key="t" class="mitre-chip">{{ t }}</span>
                <span class="text-text-tertiary tabular-nums">×{{ entry.count }}</span>
                <OButton
                  v-if="byName.get(entry.name)"
                  size="sm"
                  variant="ghost"
                  @click="investigate(entry.name)"
                >
                  Events
                </OButton>
              </div>
              <div v-if="!contributing.length" class="text-text-tertiary p-3 text-center text-xs">
                No firings recorded against this case yet
              </div>
            </div>
          </div>

          <!-- What was matched on, which is how the firings got grouped -->
          <div v-if="Object.keys(selected.group_values ?? {}).length" class="mt-4">
            <div class="text-text-tertiary text-2xs font-bold">Correlated on</div>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="(value, key) in selected.group_values"
                :key="key"
                class="border-border-default rounded-default text-2xs border px-1.5 py-0.5 font-mono"
              >
                {{ key }} = {{ value }}
              </span>
            </div>
          </div>

          <!-- Analyst notes -->
          <div class="mt-4">
            <div class="text-text-tertiary text-2xs font-bold">Add a note</div>
            <textarea
              v-model="comment"
              rows="3"
              class="border-border-default text-compact rounded-default mt-1 w-full border bg-transparent p-2 outline-none"
              placeholder="What you found, what you ruled out, what is next…"
            />
            <div class="mt-1 flex justify-end">
              <OButton
                size="sm"
                :disabled="!comment.trim() || posting"
                :loading="posting"
                @click="postComment"
              >
                Add note
              </OButton>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="!unsupported"
        class="text-text-tertiary text-compact flex flex-1 flex-col items-center justify-center gap-2"
      >
        <OIcon name="folder-open" size="xl" class="opacity-30" />
        <div>Select a case to work it</div>
      </div>
    </div>
  </div>
</template>
