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
<template>
  <ODrawer
    v-model:open="open"
    :width="74"
    :bleed="currentView === 'list' && !forbidden && !loadFailed"
    data-test="dashboards-public-links-panel"
    :title="
      dashboardTitle
        ? t('dashboard.publicLinks.panelTitleFor', { name: raw(dashboardTitle) })
        : t('dashboard.publicLinks.panelTitle')
    "
    :form-id="currentView === 'form' ? FORM_ID : undefined"
    :primary-button-label="primaryLabel"
    :secondary-button-label="currentView === 'form' ? t('common.cancel') : undefined"
    @click:primary="onPrimary"
    @click:secondary="closeForm"
  >
    <div
      v-if="forbidden"
      class="text-text-secondary py-2 text-sm"
      data-test="dashboards-public-links-panel-no-permission"
    >
      {{ t("dashboard.publicDashboard.noPublishPermission") }}
    </div>

    <OEmptyState
      v-else-if="loadFailed"
      preset="load-error"
      data-test="dashboards-public-links-panel-error"
      @action="refetchLinks"
    />

    <div
      v-else-if="currentView === 'created' && createdLink"
      class="flex flex-col gap-4"
      data-test="dashboards-public-links-panel-created"
    >
      <div class="text-text-heading text-base font-medium">
        {{ t("dashboard.publicLinks.createdTitle") }}
      </div>
      <OInput
        :model-value="publicUrl(createdLink)"
        readonly
        :label="t('dashboard.publicDashboard.publicLink')"
        data-test="dashboards-public-links-panel-created-url"
      />
      <div class="flex flex-wrap gap-2">
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="content-copy"
          data-test="dashboards-public-links-panel-created-copy-btn"
          @click="copyLink(createdLink)"
        >
          {{ t("dashboard.publicDashboard.copyLink") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="open-in-new"
          data-test="dashboards-public-links-panel-created-open-btn"
          @click="openPublicPage(createdLink)"
        >
          {{ t("dashboard.publicLinks.openPublicPage") }}
        </OButton>
      </div>
      <div class="text-text-secondary text-xs">
        {{ t("dashboard.publicDashboard.linkHint") }}
      </div>
    </div>

    <div
      v-else-if="currentView === 'form'"
      class="flex flex-col gap-4"
      data-test="dashboards-public-links-panel-form"
    >
      <div class="text-text-secondary text-sm">
        {{ editing ? t("dashboard.publicLinks.editNote") : t("dashboard.publicLinks.intro") }}
      </div>
      <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
        <OFormInput
          name="name"
          required
          :label="t('dashboard.publicLinks.name')"
          :placeholder="t('dashboard.publicLinks.namePlaceholder')"
          data-test="dashboards-public-links-panel-name-input"
        />
        <OFormSwitch
          name="timeEditable"
          :label="t('dashboard.publicDashboard.allowTimeRangeSwitch')"
          data-test="dashboards-public-links-panel-time-editable-toggle"
        />
        <OFormSelect
          v-if="timeEditable"
          name="presets"
          :options="presetOptions"
          multiple
          required
          :label="t('dashboard.publicDashboard.availableRanges')"
          data-test="dashboards-public-links-panel-presets-select"
        />
        <OFormSelect
          name="defaultPreset"
          :options="timeEditable ? selectedPresetOptions : presetOptions"
          required
          :label="
            timeEditable
              ? t('dashboard.publicDashboard.defaultRange')
              : t('dashboard.publicDashboard.timeRange')
          "
          data-test="dashboards-public-links-panel-default-select"
        />
        <OFormInput
          name="rebuildSecs"
          type="number"
          :min="minRebuildSecs"
          required
          :label="t('dashboard.publicDashboard.refreshEvery')"
          :help-text="t('dashboard.publicDashboard.refreshEveryMin', { secs: minRebuildSecs })"
          data-test="dashboards-public-links-panel-rebuild-input"
        />
        <OFormDate
          name="expires"
          clearable
          :min="today"
          :label="t('dashboard.publicDashboard.expiresOptional')"
          :help-text="t('dashboard.publicLinks.expiresHelp')"
          data-test="dashboards-public-links-panel-expires-input"
        />
      </OForm>
      <div
        v-if="variablesConfig?.list?.length"
        class="flex flex-col gap-1.5"
        data-test="dashboards-public-links-panel-variables"
      >
        <div class="text-text-secondary text-xs">
          {{ t("dashboard.publicDashboard.defaultVariableValues") }}
        </div>
        <VariablesValueSelector
          :key="formKey"
          :variablesConfig="variablesConfig"
          :selectedTimeDate="timeObj"
          :initialVariableValues="variableSeed"
          :showDynamicFilters="false"
          @variablesData="onVariablesData"
        />
      </div>
    </div>

    <div v-else class="flex flex-col gap-3" data-test="dashboards-public-links-panel-list">
      <OContent v-if="revoking" class="pt-3">
        <OBanner
          variant="error-soft"
          inline-actions
          data-test="dashboards-public-links-panel-revoke-confirm"
          :content="
            t('dashboard.publicLinks.revokeConfirm', {
              name: revoking.name ? raw(revoking.name) : t('dashboard.publicLinks.untitled'),
            })
          "
        >
          <template #actions>
            <div class="flex gap-2">
              <OButton
                variant="outline"
                size="sm-action"
                data-test="dashboards-public-links-panel-revoke-cancel-btn"
                @click="revoking = null"
              >
                {{ t("common.cancel") }}
              </OButton>
              <OButton
                variant="destructive"
                size="sm-action"
                :loading="revokePending"
                data-test="dashboards-public-links-panel-revoke-confirm-btn"
                @click="confirmRevoke"
              >
                {{ t("dashboard.publicDashboard.revoke") }}
              </OButton>
            </div>
          </template>
        </OBanner>
      </OContent>
      <OTable
        :data="filteredLinks"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :frame="false"
        pagination="none"
        :show-global-filter="false"
        :default-columns="false"
        show-index
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="public-links-panel"
        data-test="dashboards-public-links-panel-table"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
            <div class="min-w-0 flex-1 max-md:min-w-40">
              <OInput
                v-model="searchQuery"
                :placeholder="t('dashboard.publicLinks.search')"
                clearable
                class="w-full"
                data-test="dashboards-public-links-panel-search"
              >
                <template #icon-left>
                  <OIcon name="search" size="sm" />
                </template>
              </OInput>
            </div>
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastUpdatedAt || null"
            :loading="fetching"
            data-test="dashboards-public-links-panel-refresh-btn"
            @click="refetchLinks"
          />
        </template>
        <template #empty>
          <OEmptyState
            v-if="searchQuery.trim()"
            preset="no-search-results"
            filtered
            data-test="dashboards-public-links-panel-no-match"
            @action="(id?: string) => (id === 'clear-filters' ? (searchQuery = '') : undefined)"
          />
        </template>
        <template #cell-name="{ row }">
          <span class="text-text-body truncate text-sm">
            {{ row.name ? raw(row.name) : t("dashboard.publicLinks.untitled") }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <OTag type="publicLinkStatus" :value="row.status" />
        </template>
        <template #cell-ranges="{ row }">
          <PublicLinkRangesCell :link="row" />
        </template>
        <template #cell-refresh="{ row }">
          <span class="text-text-body text-sm">{{ formatExactDuration(row.rebuild_secs) }}</span>
        </template>
        <template #cell-expires="{ row }">
          <PublicLinkExpiresCell
            :link="row"
            :timezone="timezone"
            :data-test="`dashboards-public-links-panel-${row.id}-expiry`"
          />
        </template>
        <template #cell-updated="{ row }">
          <OTimeCell :value="row.last_rebuilt_at" unit="us" :timezone="timezone" />
        </template>
        <template #cell-published_by="{ row }">
          <OUserCell :value="row.published_by" />
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-0.5" @click.stop>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="content-copy"
              class="max-md:hidden"
              :data-test="`dashboards-public-links-panel-${row.id}-copy-btn`"
              @click="copyLink(row)"
            >
              <OTooltip side="bottom" :content="t('dashboard.publicDashboard.copyLink')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="open-in-new"
              class="max-md:hidden"
              :data-test="`dashboards-public-links-panel-${row.id}-open-btn`"
              @click="openPublicPage(row)"
            >
              <OTooltip side="bottom" :content="t('dashboard.publicLinks.openPublicPage')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              class="max-md:hidden"
              :data-test="`dashboards-public-links-panel-${row.id}-edit-btn`"
              @click="openForm(row)"
            >
              <OTooltip side="bottom" :content="t('dashboard.publicLinks.editSettings')" />
            </OButton>
            <OButton
              v-if="canPause(row)"
              :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
              size="icon-sm"
              :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              class="max-md:hidden"
              :data-test="`dashboards-public-links-panel-${row.id}-${row.enabled ? 'pause' : 'resume'}-btn`"
              @click="setPaused(row, row.enabled)"
            >
              <OTooltip
                side="bottom"
                :content="
                  row.enabled ? t('dashboard.publicLinks.pause') : t('dashboard.publicLinks.resume')
                "
              />
            </OButton>
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  icon-left="more-vert"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('dashboard.moreActions')"
                  :data-test="`dashboards-public-links-panel-${row.id}-menu-btn`"
                />
              </template>
              <ODropdownItem
                icon-left="content-copy"
                class="md:hidden"
                :data-test="`dashboards-public-links-panel-${row.id}-copy-menu`"
                @select="copyLink(row)"
              >
                {{ t("dashboard.publicDashboard.copyLink") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="open-in-new"
                class="md:hidden"
                :data-test="`dashboards-public-links-panel-${row.id}-open-menu`"
                @select="openPublicPage(row)"
              >
                {{ t("dashboard.publicLinks.openPublicPage") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="edit"
                class="md:hidden"
                :data-test="`dashboards-public-links-panel-${row.id}-edit-menu`"
                @select="openForm(row)"
              >
                {{ t("dashboard.publicLinks.editSettings") }}
              </ODropdownItem>
              <ODropdownItem
                v-if="canPause(row)"
                :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                class="md:hidden"
                :data-test="`dashboards-public-links-panel-${row.id}-${row.enabled ? 'pause' : 'resume'}-menu`"
                @select="setPaused(row, row.enabled)"
              >
                {{
                  row.enabled ? t("dashboard.publicLinks.pause") : t("dashboard.publicLinks.resume")
                }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete"
                variant="destructive"
                :data-test="`dashboards-public-links-panel-${row.id}-revoke-menu`"
                @select="revoking = row"
              >
                {{ t("dashboard.publicDashboard.revoke") }}
              </ODropdownItem>
            </ODropdown>
          </div>
        </template>
      </OTable>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { useOrgId } from "@/composables/query";
import { copyToClipboard } from "@/utils/clipboard";
import { formatExactDuration } from "@/utils/formatters";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import PublicLinkRangesCell from "./PublicLinkRangesCell.vue";
import PublicLinkExpiresCell from "./PublicLinkExpiresCell.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import VariablesValueSelector from "@/components/dashboards/VariablesValueSelector.vue";
import type { PublicLink } from "@/services/public_dashboards_admin";
import {
  publicLinksForDashboardQuery,
  revokePublicLinkMutation,
  savePublicLinkMutation,
  setPublicLinkPausedMutation,
} from "@/services/public_dashboards.queries";
import {
  PRESET_SECONDS,
  makePublicLinkSchema,
  publicLinkDefaults,
  publicLinkFormFrom,
  todayIn,
  toPublicLinkConfig,
  type PublicLinkForm,
} from "./PublicLinkForm.schema";
import { publicLinkColumns, publicLinkUrl as publicUrl, shortRange } from "./publicLinkDisplay";

type VariableValues = { values?: Array<{ name: string; value: unknown }> };
type PanelView = "list" | "form" | "created";

interface PresetOption extends SelectOption {
  value: number;
}

const FORM_ID = "dashboards-public-links-panel-form";

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    dashboardId: string;
    dashboardTitle?: string;
    // Variable definitions, the global time range and the live selection seed the pickers (WYSIWYG).
    variablesConfig?: { list?: unknown[] };
    timeObj?: Record<string, unknown>;
    currentValues?: VariableValues;
    // Open straight on this link's edit form (from the org-wide list).
    editLinkId?: string;
  }>(),
  { modelValue: false },
);
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const store = useStore();
const { t } = useI18nTyped();
const { showErrorNotification, showPositiveNotification } = useNotifications();
const orgId = useOrgId();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

const timezone = computed<string>(
  () => store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
);
const minRebuildSecs = computed(
  () => Number(store.state.zoConfig?.public_dashboard_min_rebuild_secs) || 30,
);
const today = computed(() => todayIn(timezone.value));

const linksQuery = useQuery(() =>
  Object.assign(publicLinksForDashboardQuery(orgId.value, props.dashboardId), {
    enabled: open.value && !!orgId.value && !!props.dashboardId,
  }),
);
const links = computed(() => linksQuery.data.value ?? []);
const loading = linksQuery.isPending;
const forbidden = computed(
  () =>
    (linksQuery.error.value as { response?: { status?: number } } | null)?.response?.status === 403,
);
const loadFailed = computed(() => !!linksQuery.error.value && !forbidden.value);
const refetchLinks = () => linksQuery.refetch();
const fetching = linksQuery.isFetching;
const lastUpdatedAt = linksQuery.dataUpdatedAt;
const searchQuery = ref("");
const filteredLinks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return links.value;
  return links.value.filter((link) =>
    [link.name, link.published_by].some((v) => v.toLowerCase().includes(q)),
  );
});

const saveMutation = useMutation(() => savePublicLinkMutation(orgId.value));
const pauseMutation = useMutation(() => setPublicLinkPausedMutation(orgId.value));
const revokeMutation = useMutation(() => revokePublicLinkMutation(orgId.value));
const revokePending = revokeMutation.isPending;

const view = ref<PanelView>("list");
const editing = ref<PublicLink | null>(null);
const createdLink = ref<PublicLink | null>(null);
const revoking = ref<PublicLink | null>(null);
// Remounts the variable pickers so each form opens on its own seed.
const formKey = ref(0);
const liveVariables = ref<VariableValues | null>(null);

// A dashboard with no links opens straight on the create form.
const currentView = computed<PanelView>(() =>
  view.value === "list" && linksQuery.isSuccess.value && !links.value.length ? "form" : view.value,
);

const primaryLabel = computed<I18nText | undefined>(() => {
  if (forbidden.value || loadFailed.value) return undefined;
  if (currentView.value === "form") {
    return editing.value
      ? t("dashboard.publicLinks.saveChanges")
      : t("dashboard.publicLinks.createLink");
  }
  if (currentView.value === "created") return t("dashboard.publicLinks.backToLinks");
  return t("dashboard.publicLinks.newLink");
});

const form = useOForm<PublicLinkForm>({
  defaultValues: publicLinkDefaults(),
  schema: makePublicLinkSchema(t, minRebuildSecs.value, today.value),
  onSubmit: (value) => submit(value),
});
const timeEditable = form.useStore((s) => s.values.timeEditable);
const selectedPresets = form.useStore((s) => s.values.presets);

const presetOptions = computed<PresetOption[]>(() =>
  PRESET_SECONDS.map((value) => ({ value, label: presetLabel(value) })),
);
const selectedPresetOptions = computed<PresetOption[]>(() =>
  presetOptions.value.filter((o) => selectedPresets.value.includes(o.value)),
);

// Editing seeds the pickers from the link's frozen values, creating from the live selection.
const variableSeed = computed(() => ({
  value: editing.value
    ? { ...editing.value.frozen_variables }
    : (props.currentValues?.values ?? []).reduce<Record<string, unknown>>((m, v) => {
        if (v?.name !== undefined && v?.name !== null) m[v.name] = v.value;
        return m;
      }, {}),
}));

const columns = publicLinkColumns(t);

function presetLabel(secs: number): I18nText {
  return t("dashboard.publicDashboard.past", { range: raw(shortRange(secs)) });
}

// Expired and orphaned links can't be resumed, so they offer no pause toggle.
function canPause(link: PublicLink): boolean {
  return link.status !== "expired" && link.status !== "dashboard_deleted";
}

function serverMessage(e: unknown): I18nText {
  return raw((e as { response?: { data?: { message?: string } } })?.response?.data?.message);
}

const onVariablesData = (d: VariableValues) => {
  liveVariables.value = d;
};

function frozenVariables(): Record<string, unknown> {
  const source = liveVariables.value ?? (editing.value ? null : props.currentValues);
  // Without the pickers (opened from the org list) an edit keeps the link's frozen values.
  if (!source?.values) return editing.value ? { ...editing.value.frozen_variables } : {};
  return source.values.reduce<Record<string, unknown>>((m, item) => {
    if (item?.name !== undefined && item?.name !== null) m[item.name] = item.value;
    return m;
  }, {});
}

function openForm(link: PublicLink | null) {
  editing.value = link;
  revoking.value = null;
  liveVariables.value = null;
  formKey.value += 1;
  form.reset(link ? publicLinkFormFrom(link, timezone.value) : publicLinkDefaults());
  view.value = "form";
}

function closeForm() {
  editing.value = null;
  form.reset(publicLinkDefaults());
  if (links.value.length) view.value = "list";
  else open.value = false;
}

function onPrimary() {
  if (currentView.value === "list") openForm(null);
  else if (currentView.value === "created") view.value = "list";
}

async function submit(value: PublicLinkForm) {
  try {
    const saved = await saveMutation.mutateAsync({
      dashboardId: props.dashboardId,
      linkId: editing.value?.id,
      config: toPublicLinkConfig(value, frozenVariables(), timezone.value),
    });
    if (editing.value) {
      showPositiveNotification(t("dashboard.publicLinks.savedToast"));
      editing.value = null;
      view.value = "list";
    } else {
      createdLink.value = saved;
      view.value = "created";
    }
  } catch (e: unknown) {
    showErrorNotification(serverMessage(e) || t("dashboard.publicDashboard.publishFailed"));
  }
}

async function setPaused(link: PublicLink, paused: boolean) {
  try {
    await pauseMutation.mutateAsync({ link, paused });
    showPositiveNotification(
      paused ? t("dashboard.publicLinks.pausedToast") : t("dashboard.publicLinks.resumedToast"),
    );
  } catch (e: unknown) {
    showErrorNotification(serverMessage(e) || t("dashboard.publicLinks.actionFailed"));
  }
}

async function confirmRevoke() {
  if (!revoking.value) return;
  try {
    await revokeMutation.mutateAsync(revoking.value);
    showPositiveNotification(t("dashboard.publicDashboard.revokedToast"));
    revoking.value = null;
  } catch (e: unknown) {
    showErrorNotification(serverMessage(e) || t("dashboard.publicDashboard.revokeFailed"));
  }
}

function copyLink(link: PublicLink) {
  copyToClipboard(publicUrl(link), t, {
    successMessage: t("dashboard.publicDashboard.linkCopied"),
  });
}

function openPublicPage(link: PublicLink) {
  window.open(publicUrl(link), "_blank", "noopener");
}

// Each opening starts on the list; an edit request jumps to that link's form once links load.
watch(open, (isOpen) => {
  if (!isOpen) return;
  view.value = "list";
  editing.value = null;
  createdLink.value = null;
  revoking.value = null;
  // A dashboard with no links opens straight on the form, so errors from an earlier attempt must not carry over.
  form.reset(publicLinkDefaults());
});
watch(
  () => [open.value, props.editLinkId, links.value] as const,
  ([isOpen, editId, list]) => {
    if (!isOpen || !editId || view.value !== "list") return;
    const link = list.find((l) => l.id === editId);
    if (link) openForm(link);
  },
  { immediate: true },
);
</script>
