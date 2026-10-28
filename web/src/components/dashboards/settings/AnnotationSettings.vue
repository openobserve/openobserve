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

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getDashboard, updateDashboard } from "@/utils/commons";
import useNotifications from "@/composables/useNotifications";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DashboardHeader from "./common/DashboardHeader.vue";
import AnnotationSourceForm from "./AnnotationSourceForm.vue";
import type { AnnotationPanelOption } from "./AnnotationSourceForm.schema";
import type { AnnotationSource } from "@/ts/interfaces/dashboard";
import {
  ANNOTATION_PANEL_TYPES,
  MAX_ANNOTATION_SOURCES,
  resolveAnnotationSourceColor,
} from "@/utils/dashboard/annotationSources";

interface DashboardPanel {
  id: string;
  title?: string;
  type: string;
}

interface DashboardTab {
  tabId: string;
  name?: string;
  panels?: DashboardPanel[];
}

interface DashboardJson {
  dashboardId?: string;
  tabs?: DashboardTab[];
  variables?: { list?: Array<{ name?: string; scope?: string }> };
  annotationSources?: AnnotationSource[];
}

const emit = defineEmits<{
  (_e: "save"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const {
  showPositiveNotification,
  showErrorNotification,
  showConfictErrorNotificationWithRefreshBtn,
} = useNotifications();

const dashboard = ref<DashboardJson>({});
const sources = computed<AnnotationSource[]>(() => dashboard.value.annotationSources ?? []);
const atSourceCap = computed(() => sources.value.length >= MAX_ANNOTATION_SOURCES);
const sourceCapHint = computed(() =>
  t("dashboard.annotationSources.tooMany", { max: MAX_ANNOTATION_SOURCES }),
);

const editing = ref<{ source: AnnotationSource | null } | null>(null);
const deleteTarget = ref<AnnotationSource | null>(null);
const confirmDeleteOpen = ref(false);

const askDelete = (source: AnnotationSource) => {
  deleteTarget.value = source;
  confirmDeleteOpen.value = true;
};

const dashboardId = () => String(route.query.dashboard ?? "");
const folderId = () => String(route.query.folder ?? "default");

const loadDashboard = async () => {
  const data = await getDashboard(store, dashboardId(), folderId());
  dashboard.value = JSON.parse(JSON.stringify(data ?? {}));
};

onMounted(loadDashboard);

const timeSeriesPanels = computed(() =>
  (dashboard.value.tabs ?? []).map((tab) => ({
    tab,
    panels: (tab.panels ?? []).filter((panel) => ANNOTATION_PANEL_TYPES.includes(panel.type)),
  })),
);

const panelTitles = computed(() => {
  const titles = new Map<string, string>();
  timeSeriesPanels.value.forEach(({ panels }) =>
    panels.forEach((panel) => titles.set(panel.id, panel.title || panel.id)),
  );
  return titles;
});

const panelOptions = computed<AnnotationPanelOption[]>(() => {
  const groups = timeSeriesPanels.value.filter(({ panels }) => panels.length);
  const withHeaders = groups.length > 1;
  return groups.flatMap(({ tab, panels }) => [
    ...(withHeaders
      ? [{ label: raw(tab.name || tab.tabId), value: `tab:${tab.tabId}`, header: true }]
      : []),
    ...panels.map((panel) => ({ label: raw(panel.title || panel.id), value: panel.id })),
  ]);
});

const variableNames = computed(() =>
  (dashboard.value.variables?.list ?? [])
    .filter((variable) => !variable.scope || variable.scope === "global")
    .map((variable) => variable.name ?? "")
    .filter((name) => name !== ""),
);

const siblingSourceNames = computed(() =>
  sources.value.filter((item) => item.id !== editing.value?.source?.id).map((item) => item.name),
);

const summaryOf = (source: AnnotationSource) =>
  source.mode === "sql"
    ? raw((source.query ?? "").split("\n")[0])
    : raw(`${source.streamType} · ${source.stream}`);

// Ids of panels deleted before pruning existed are skipped, never shown raw.
const livePanels = (source: AnnotationSource) =>
  source.panels?.filter((id) => panelTitles.value.has(id)) ?? null;

const panelsLabel = (source: AnnotationSource): I18nText => {
  const panels = livePanels(source);
  if (panels === null) return t("dashboard.annotationSources.allTimeSeriesPanels");
  if (!panels.length) return t("dashboard.annotationSources.noPanels");
  if (panels.length === 1) return raw(panelTitles.value.get(panels[0]));
  return t("dashboard.annotationSources.panelsCount", { n: panels.length }, panels.length);
};

const columns: OTableColumnDef<AnnotationSource>[] = [
  {
    id: "name",
    header: t("dashboard.name"),
    accessorKey: "name",
    size: COL.name + 80,
    meta: { align: "left", isName: true, autoWidth: true },
  },
  {
    id: "panels",
    header: t("dashboard.annotationSources.panels"),
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "enabled",
    header: t("dashboard.annotationSources.enabled"),
    size: COL.toggle,
    meta: { align: "center" },
  },
  {
    id: "actions",
    header: t("dashboard.actions"),
    isAction: true,
    size: 120,
    meta: { align: "center", actionCount: 2 },
  },
];

// getDashboard reads the Vuex cache, which is current only because updateDashboard always refreshes it first.
const persist = async (
  computeNext: (current: AnnotationSource[]) => AnnotationSource[],
  successMessage: I18nText | null,
) => {
  try {
    const data = JSON.parse(
      JSON.stringify(await getDashboard(store, dashboardId(), folderId())),
    ) as DashboardJson;
    const next = computeNext(data.annotationSources ?? []);
    // Re-checked here against the freshly-read dashboard: a concurrent edit may have filled the cap since atSourceCap was last computed.
    if (next.length > MAX_ANNOTATION_SOURCES) {
      showErrorNotification(
        t("dashboard.annotationSources.tooMany", { max: MAX_ANNOTATION_SOURCES }),
        {
          timeout: 2000,
        },
      );
      return false;
    }
    if (next.length) data.annotationSources = next;
    else delete data.annotationSources;
    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId(),
      data,
      folderId(),
    );
    dashboard.value = { ...data, annotationSources: next };
    if (successMessage) showPositiveNotification(successMessage);
    emit("save");
    return true;
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } })
      ?.response;
    const message =
      raw(response?.data?.message) ||
      raw((error as Error)?.message) ||
      t("dashboard.annotationSources.saveFailed");
    if (response?.status === 409) {
      showConfictErrorNotificationWithRefreshBtn(message, t);
    } else {
      showErrorNotification(message, { timeout: 2000 });
    }
    return false;
  }
};

// Chains every write through here so two rows toggled back to back never race the same dashboard hash.
let writeQueue: Promise<boolean> = Promise.resolve(true);
const enqueueWrite = (
  computeNext: (current: AnnotationSource[]) => AnnotationSource[],
  successMessage: I18nText | null,
) => {
  const run = writeQueue.then(() => persist(computeNext, successMessage));
  writeQueue = run;
  return run;
};

const saveSource = async (source: AnnotationSource) => {
  const ok = await enqueueWrite(
    (current) =>
      current.some((item) => item.id === source.id)
        ? current.map((item) => (item.id === source.id ? source : item))
        : [...current, source],
    t("dashboard.annotationSources.saved"),
  );
  if (ok) editing.value = null;
};

const togglingIds = ref<Set<string>>(new Set());

// Disabled while its own write is queued/in-flight, so a double-click can't fire two overlapping saves.
const toggleEnabled = async (source: AnnotationSource, enabled: boolean) => {
  togglingIds.value = new Set(togglingIds.value).add(source.id);
  try {
    await enqueueWrite(
      (current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)),
      null,
    );
  } finally {
    const next = new Set(togglingIds.value);
    next.delete(source.id);
    togglingIds.value = next;
  }
};

const confirmDelete = async () => {
  const target = deleteTarget.value;
  deleteTarget.value = null;
  if (!target) return;
  await enqueueWrite(
    (current) => current.filter((item) => item.id !== target.id),
    t("dashboard.annotationSources.deleted"),
  );
};

const openAdd = () => {
  editing.value = { source: null };
};

const openEdit = (source: AnnotationSource) => {
  const panels = livePanels(source);
  editing.value = { source: panels === null ? source : { ...source, panels } };
};
</script>

<template>
  <div class="h-full max-h-full overflow-hidden" data-test="dashboard-annotation-settings">
    <AnnotationSourceForm
      v-if="editing"
      :source="editing.source"
      :color-index="sources.length"
      :panel-options="panelOptions"
      :variable-names="variableNames"
      :sibling-names="siblingSourceNames"
      :dashboard-id="dashboardId()"
      :on-save="saveSource"
      @cancel="editing = null"
    />
    <div v-else class="flex h-full max-h-full flex-col overflow-hidden">
      <DashboardHeader :title="t('dashboard.annotationSources.title')">
        <template #right>
          <OButton
            variant="primary"
            size="sm"
            :disabled="atSourceCap"
            :focusable-unavailable="atSourceCap"
            data-test="dashboard-annotation-source-add"
            @click="openAdd"
            >{{ t("dashboard.annotationSources.addSource") }}
            <template #unavailable-reason>{{ sourceCapHint }}</template>
            <OTooltip v-if="atSourceCap" :content="sourceCapHint"
          /></OButton>
        </template>
      </DashboardHeader>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <OTable
          data-test="dashboard-annotation-sources-table"
          :data="sources"
          :columns="columns"
          row-key="id"
          :frame="false"
          pagination="none"
          sorting="none"
          selection="none"
          :default-columns="false"
          :show-global-filter="false"
        >
          <template #empty>
            <OEmptyState
              size="hero"
              illustration="box"
              variant="create"
              :title="t('dashboard.annotationSources.emptyTitle')"
              :description="t('dashboard.annotationSources.emptyDescription')"
              :action-label="t('dashboard.annotationSources.addSource')"
              data-test="dashboard-annotation-sources-empty"
              @action="openAdd"
            />
          </template>

          <template #cell-name="{ row }">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: resolveAnnotationSourceColor(row) }"
                :data-test="`dashboard-annotation-source-swatch-${row.id}`"
              ></span>
              <div class="flex min-w-0 flex-col">
                <div class="flex min-w-0 items-center gap-1.5">
                  <OTruncatedText :data-test="`dashboard-annotation-source-name-${row.id}`">{{
                    row.name
                  }}</OTruncatedText>
                  <OTag
                    variant="default-soft"
                    size="sm"
                    class="shrink-0"
                    :data-test="`dashboard-annotation-source-mode-${row.id}`"
                    >{{
                      row.mode === "sql"
                        ? t("dashboard.annotationSources.customSql")
                        : t("dashboard.annotationSources.builder")
                    }}</OTag
                  >
                </div>
                <OTruncatedText class="text-text-secondary font-mono text-xs">{{
                  summaryOf(row)
                }}</OTruncatedText>
              </div>
            </div>
          </template>

          <template #cell-panels="{ row }">
            <div class="flex min-w-0 items-center gap-1">
              <OTruncatedText
                class="text-text-secondary"
                :data-test="`dashboard-annotation-source-panels-${row.id}`"
                >{{ panelsLabel(row) }}</OTruncatedText
              >
              <OTooltip
                v-if="livePanels(row)?.length === 0"
                :content="t('dashboard.annotationSources.panelsDeletedHint')"
                :delay="200"
              >
                <span
                  tabindex="0"
                  role="img"
                  :aria-label="t('dashboard.annotationSources.panelsDeletedHint')"
                  class="text-text-secondary rounded-default focus-visible:ring-accent/40 inline-flex shrink-0 cursor-help outline-none focus-visible:ring-2"
                  :data-test="`dashboard-annotation-source-panels-hint-${row.id}`"
                >
                  <OIcon name="info-outline" size="xs" />
                </span>
              </OTooltip>
            </div>
          </template>

          <template #cell-enabled="{ row }">
            <OSwitch
              :model-value="row.enabled !== false"
              :disabled="togglingIds.has(row.id)"
              :aria-label="t('dashboard.annotationSources.enabledAria', { name: row.name })"
              :data-test="`dashboard-annotation-source-enabled-${row.id}`"
              @update:model-value="toggleEnabled(row, $event === true)"
            />
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-center gap-2">
              <OButton
                variant="ghost"
                size="icon"
                icon-left="edit"
                class="max-md:hidden"
                :title="t('dashboard.annotationSources.edit')"
                :data-test="`dashboard-annotation-source-edit-${row.id}`"
                @click="openEdit(row)"
              />
              <OButton
                variant="ghost"
                size="icon"
                icon-left="delete"
                class="max-md:hidden"
                :title="t('dashboard.annotationSources.delete')"
                :data-test="`dashboard-annotation-source-delete-${row.id}`"
                @click.stop="askDelete(row)"
              />
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    icon-left="more-vert"
                    :title="t('dashboard.moreActions')"
                    variant="ghost"
                    size="icon-xs-sq"
                    class="md:hidden"
                    :data-test="`dashboard-annotation-source-menu-${row.id}`"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  icon-left="edit"
                  class="md:hidden"
                  :data-test="`dashboard-annotation-source-edit-${row.id}-menu`"
                  @select="openEdit(row)"
                >
                  <span>{{ t("dashboard.annotationSources.edit") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="delete"
                  variant="destructive"
                  class="md:hidden"
                  :data-test="`dashboard-annotation-source-delete-${row.id}-menu`"
                  @select="askDelete(row)"
                >
                  <span>{{ t("dashboard.annotationSources.delete") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
        </OTable>
      </div>
      <ConfirmDialog
        v-model="confirmDeleteOpen"
        :title="t('dashboard.annotationSources.deleteTitle')"
        :message="
          t('dashboard.annotationSources.deleteMessage', { name: raw(deleteTarget?.name ?? '') })
        "
        data-test="dashboard-annotation-source-delete-dialog"
        @update:ok="confirmDelete"
        @update:cancel="deleteTarget = null"
      />
    </div>
  </div>
</template>
