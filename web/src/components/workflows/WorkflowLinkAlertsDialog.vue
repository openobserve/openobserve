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

<!--
  "Link Workflow To Alerts" dialog. Shown right after a workflow is created so
  the user can attach it to existing alerts in one step (they can also link it
  later from an alert's own settings — Alert Settings has a Workflows section).

  UX: pick a Folder (first dropdown), then multi-select its Alerts (second
  dropdown, with ticks). Switch folders to keep adding — the selection
  ACCUMULATES across folders (the alerts dropdown only ever edits the current
  folder's slice of the global selection). A running count + removable chips at
  the top always show the full cross-folder selection.

  The link lives on the ALERT side (`alert.workflows: string[]` of workflow ids),
  so linking = for each selected alert: GET the full alert, add this workflow id
  to its `workflows`, PUT it back. A single v2 list call with the folder param
  omitted returns every alert across folders, each carrying folder_id /
  folder_name — so folders and per-folder alerts are derived client-side.
-->
<template>
  <ODialog
    v-model:open="open"
    data-test="workflow-link-alerts-dialog"
    size="md"
    :title="t('workflow.linkAlerts.title')"
    :primary-button-label="
      selected.length
        ? t('workflow.linkAlerts.linkN', { count: selected.length })
        : t('workflow.linkAlerts.link')
    "
    :primary-button-disabled="selected.length === 0 || linking"
    :primary-button-loading="linking"
    :secondary-button-label="t('workflow.linkAlerts.skip')"
    @click:primary="linkSelected"
    @click:secondary="close"
  >
    <div class="flex flex-col gap-4 text-left">
      <OText variant="meta" as="p">
        {{ t("workflow.linkAlerts.intro", { name: workflowName }) }}
      </OText>

      <div
        v-if="loadError"
        class="py-6 text-center"
      >
        <OText variant="meta" as="p" class="text-input-error-text">
          {{ t("workflow.linkAlerts.loadError") }}
        </OText>
      </div>

      <div
        v-else-if="!loading && !alerts.length"
        class="py-6 text-center"
      >
        <OText variant="meta" as="p">
          {{ t("workflow.linkAlerts.empty") }}
        </OText>
      </div>

      <template v-else>
        <!-- Two dropdowns: folder → alerts -->
        <div class="grid grid-cols-2 gap-3">
          <OSelect
            v-model="selectedFolder"
            :label="t('workflow.linkAlerts.folderLabel')"
            :options="folderOptions"
            :loading="loading"
            data-test="workflow-link-alerts-folder"
          />
          <OSelect
            v-model="folderSelection"
            :label="t('workflow.linkAlerts.alertsLabel')"
            :placeholder="t('workflow.linkAlerts.alertsPlaceholder')"
            :options="alertOptions"
            :loading="loading"
            multiple
            searchable
            data-test="workflow-link-alerts-select"
          >
            <template #empty>{{
              t("workflow.linkAlerts.noAlertsInFolder")
            }}</template>
          </OSelect>
        </div>

        <!-- Running cross-folder selection. Always rendered at a FIXED height so
             adding / removing chips never resizes the dialog; it scrolls when the
             chips overflow. Native chip tokens keep it consistent with the
             OSelect trigger. -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <OText variant="meta" as="span" class="font-medium">
              {{ t("workflow.linkAlerts.selectedCount", { count: selected.length }) }}
            </OText>
            <OButton
              variant="ghost"
              size="sm"
              :disabled="!selected.length"
              data-test="workflow-link-alerts-clear"
              @click="clearAll"
            >
              {{ t("workflow.linkAlerts.clear") }}
            </OButton>
          </div>
          <div
            class="h-20 overflow-y-auto content-start flex flex-wrap gap-1 rounded-default border border-border-default p-2"
          >
            <span
              v-for="row in selectedAlertRows"
              :key="row.alert_id"
              :title="row.folder_name"
              class="inline-flex items-center gap-1 rounded-default px-2 py-0.5 text-xs leading-none max-w-40 h-fit bg-select-item-selected-bg text-select-item-selected-text"
              :data-test="`workflow-link-alerts-chip-${row.alert_id}`"
            >
              <span class="truncate">{{ row.name }}</span>
              <OIcon
                name="close"
                size="xs"
                class="shrink-0 cursor-pointer hover:opacity-70"
                @click="removeAlert(row.alert_id)"
              />
            </span>
            <OText
              v-if="!selected.length"
              variant="meta"
              as="span"
              class="text-text-secondary"
            >
              {{ t("workflow.linkAlerts.noneSelected") }}
            </OText>
          </div>
        </div>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

import alertsService from "@/services/alerts";

const props = defineProps<{ workflowId: string; workflowName: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "linked"): void }>();

const { t } = useI18n();
const store = useStore();

const orgId = () => store.state.selectedOrganization.identifier as string;

// v-model:open — closing the dialog (X / overlay) routes through close().
const open = computed({
  get: () => true,
  set: (v: boolean) => {
    if (!v) close();
  },
});

const loading = ref(true);
const loadError = ref(false);
const linking = ref(false);
const selectedFolder = ref<string>("");
// Global, cross-folder selection of alert ids.
const selected = ref<string[]>([]);

interface AlertRow {
  alert_id: string;
  name: string;
  folder_id: string;
  folder_name: string;
}
const alerts = ref<AlertRow[]>([]);

// A single v2 list call with the folder param omitted returns every alert across
// folders, each item carrying folder_id / folder_name.
const loadAlerts = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    // The leading 0, 0 are `page_num` / `page_size`. They are NOT a cap: the v2
    // helper accepts them for signature-compatibility with the v1 `list()` but
    // never puts them in the URL (see services/alerts.ts — it builds
    // `?sort_by&desc&name` plus optional folder/substring/type only), and
    // /api/v2/{org}/alerts returns EVERY match when `page_size` is absent. They
    // are passed as 0 rather than a plausible-looking page size so this does not
    // read as a silent 1000-row truncation — the picker does see every alert.
    const res = await alertsService.listByFolderId(
      0,
      0,
      "name",
      false,
      "",
      orgId(),
      "",
    );
    const list = res.data?.list ?? [];
    alerts.value = list
      // Anomaly-detection alerts use a separate update path; keep this to
      // regular scheduled / realtime alerts.
      .filter((a: any) => a.alert_type !== "anomaly_detection")
      .map((a: any) => ({
        alert_id: String(a.alert_id),
        name: a.name,
        folder_id: a.folder_id || "default",
        folder_name: a.folder_name || "default",
      }));
    // Default to the first folder so the alerts dropdown is populated.
    selectedFolder.value = folderOptions.value[0]?.value ?? "";
  } catch (e) {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
};

// Folders derived from the loaded alerts (only folders that hold alerts show up),
// default folder first then alphabetical.
const folderOptions = computed(() => {
  const byId = new Map<string, string>();
  for (const a of alerts.value) {
    if (!byId.has(a.folder_id)) byId.set(a.folder_id, a.folder_name);
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ label, value }))
    .sort((x, y) => {
      if (x.value === "default") return -1;
      if (y.value === "default") return 1;
      return x.label.localeCompare(y.label);
    });
});

// Alerts in the currently-selected folder.
const alertOptions = computed(() =>
  alerts.value
    .filter((a) => a.folder_id === selectedFolder.value)
    .map((a) => ({ label: a.name, value: a.alert_id })),
);

// The alerts dropdown only edits the CURRENT folder's slice of the global
// selection — reading returns the current folder's selected ids, writing swaps
// them in without disturbing selections made in other folders.
const folderSelection = computed<string[]>({
  get: () => {
    const inFolder = new Set(alertOptions.value.map((o) => o.value));
    return selected.value.filter((id) => inFolder.has(id));
  },
  set: (vals: string[]) => {
    const inFolder = new Set(alertOptions.value.map((o) => o.value));
    selected.value = [
      ...selected.value.filter((id) => !inFolder.has(id)),
      ...vals,
    ];
  },
});

// Selected alert rows (across all folders) for the summary chips.
const selectedAlertRows = computed(() => {
  const chosen = new Set(selected.value);
  return alerts.value.filter((a) => chosen.has(a.alert_id));
});

const removeAlert = (id: string) => {
  selected.value = selected.value.filter((x) => x !== id);
};
const clearAll = () => {
  selected.value = [];
};

// Link = for each selected alert: GET the full alert, add this workflow id to
// its `workflows`, PUT it back (v2 GET returns the Alert model; the v2 update
// body flattens that same model, so it round-trips cleanly).
const linkSelected = async () => {
  if (!selected.value.length || linking.value) return;
  linking.value = true;
  const org = orgId();
  const byId = new Map(alerts.value.map((a) => [a.alert_id, a]));
  let ok = 0;
  let failed = 0;
  for (const alertId of selected.value) {
    try {
      const res = await alertsService.get_by_alert_id(org, alertId);
      const alert = res.data;
      const wfs: string[] = Array.isArray(alert.workflows) ? alert.workflows : [];
      if (!wfs.includes(props.workflowId)) wfs.push(props.workflowId);
      alert.workflows = wfs;
      await alertsService.update_by_alert_id(
        org,
        alert,
        byId.get(alertId)?.folder_id,
      );
      ok += 1;
    } catch (e) {
      failed += 1;
    }
  }
  linking.value = false;

  if (ok && !failed) {
    toast({
      message: t("workflow.linkAlerts.linkSuccess", { count: ok }),
      variant: "success",
    });
  } else if (ok && failed) {
    toast({
      message: t("workflow.linkAlerts.linkPartial", { ok, failed }),
      variant: "warning",
    });
  } else {
    // Nothing linked — keep the dialog open with the selection intact so the user
    // can retry. `linked` would dismiss it: the parent routes away on it.
    toast({ message: t("workflow.linkAlerts.linkError"), variant: "error" });
    return;
  }

  emit("linked");
};

const close = () => emit("close");

onMounted(loadAlerts);
</script>
