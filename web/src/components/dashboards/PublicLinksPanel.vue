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
    :close-guard="guardClose"
    :bleed="currentView === 'list' && !forbidden && !loadFailed"
    data-test="dashboards-public-links-panel"
    :title="drawerTitle"
    :form-id="currentView === 'form' ? FORM_ID : undefined"
    :primary-button-label="primaryLabel"
    :primary-button-disabled="currentView === 'form' && variablesPending"
    :secondary-button-label="currentView === 'form' ? t('common.cancel') : undefined"
    @click:secondary="closeForm"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-2">
        <!-- Same tile as OPageHeader's back button, which it offers only as a page-header prop. -->
        <button
          v-if="showBack"
          type="button"
          class="rounded-default bg-surface-subtle text-text-body hover:bg-button-ghost-hover-bg focus-visible:ring-focus-ring-accent inline-flex h-8 w-8 shrink-0 items-center justify-center transition-colors outline-none focus-visible:ring-4 focus-visible:ring-inset"
          :aria-label="t('dashboard.publicLinks.backToLinks')"
          data-test="dashboards-public-links-panel-back-btn"
          @click="goBack"
        >
          <OIcon name="chevron-left" size="md" />
          <OTooltip side="bottom" :content="t('dashboard.publicLinks.backToLinks')" />
        </button>
        <span
          v-else
          class="rounded-default bg-tabs-active-bg text-tabs-active-text inline-flex h-8 w-8 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <OIcon name="public" size="md" />
        </span>
        <span class="text-dialog-header-text truncate text-base font-semibold">
          {{ drawerTitle }}
        </span>
      </div>
    </template>
    <!-- Listing and creating are separate grants, so a refused list doesn't mean a refused create. -->
    <OEmptyState
      v-if="forbidden && currentView === 'list'"
      preset="no-access"
      :description="t('dashboard.publicDashboard.noPublishPermission')"
      :action-label="t('dashboard.publicLinks.newLink')"
      data-test="dashboards-public-links-panel-no-permission"
      @action="openForm(null)"
    />

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
        <component :is="form.Field" name="ranges">
          <template #default="{ field }">
            <div class="flex flex-col gap-1.5" data-test="dashboards-public-links-panel-ranges">
              <span
                class="o-input-label text-compact text-input-label-text flex items-center gap-1 leading-tight font-medium"
              >
                {{ t("dashboard.publicDashboard.availableRanges")
                }}<span aria-hidden="true" class="select-none">*</span>
              </span>
              <div class="flex flex-wrap items-start gap-3 pt-2">
                <div
                  v-for="(row, index) in rows"
                  :key="row.id"
                  class="flex max-w-full flex-col gap-1"
                  :data-test="`dashboards-public-links-panel-range-${index}`"
                >
                  <div class="relative">
                    <DateTime
                      class="min-w-0"
                      field-appearance
                      menu-align="start"
                      auto-apply
                      hide-range-shift
                      :default-type="row.range.type"
                      :default-relative-time="
                        row.range.type === 'relative' ? pickerPeriod(row.range.secs) : '1h'
                      "
                      :default-absolute-time="
                        row.range.type === 'absolute'
                          ? { startTime: row.range.start, endTime: row.range.end }
                          : undefined
                      "
                      :data-test-name="`dashboards-public-links-panel-range-${index}-picker`"
                      @on:date-change="(value: PickedTime) => onRangeChanged(row, value)"
                    />
                    <OButton
                      variant="outline"
                      size="icon-xs-circle"
                      class="bg-surface-base! absolute! -end-1.5 -top-1.5 size-4!"
                      :aria-label="
                        t('dashboard.publicLinks.removeRange', {
                          range: longRange(row.range, t, timezone),
                        })
                      "
                      :data-test="`dashboards-public-links-panel-range-${index}-remove-btn`"
                      @click="removeRange(row)"
                    >
                      <template #icon-left><OIcon name="close" size="xs" /></template>
                    </OButton>
                  </div>
                  <span
                    v-if="rowErrors[index]"
                    class="text-select-error-text w-0 min-w-full text-xs leading-snug"
                    role="alert"
                    :data-test="`dashboards-public-links-panel-range-${index}-error`"
                  >
                    {{ rowErrors[index] }}
                  </span>
                </div>
                <OButton
                  v-if="rows.length < MAX_RANGES"
                  variant="outline"
                  size="sm"
                  icon-left="add"
                  data-test="dashboards-public-links-panel-add-range-btn"
                  @click="addRange"
                >
                  {{ t("dashboard.publicLinks.addRange") }}
                </OButton>
              </div>
              <span
                v-if="field.state.meta.errors.length"
                class="text-select-error-text text-xs leading-none"
                role="alert"
              >
                {{ firstFieldError(field.state.meta.errors) }}
              </span>
            </div>
          </template>
        </component>
        <OFormSelect
          name="defaultKey"
          :options="defaultOptions"
          required
          :label="t('dashboard.publicDashboard.defaultRange')"
          data-test="dashboards-public-links-panel-default-select"
        />
        <OFormSelect
          v-if="ranges.some((r) => r.type === 'relative')"
          name="rebuildSecs"
          :options="refreshOptions"
          required
          :label="t('dashboard.publicDashboard.refreshEvery')"
          data-test="dashboards-public-links-panel-rebuild-select"
        >
          <template #tooltip>
            <OTooltip
              side="right"
              max-width="20rem"
              :content="t('dashboard.publicLinks.refreshEveryHint')"
            />
          </template>
        </OFormSelect>
        <OFormDate
          name="expires"
          clearable
          :min="expiresMin"
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
        <OBanner
          variant="info"
          icon="info"
          dense
          :content="t('dashboard.publicLinks.frozenVariablesNote')"
          data-test="dashboards-public-links-panel-variables-note"
        />
        <div
          v-if="variablesPending"
          class="text-text-secondary flex items-center gap-2 text-xs"
          role="status"
          data-test="dashboards-public-links-panel-variables-loading"
        >
          <OSpinner size="xs" />
          {{ t("dashboard.publicLinks.variablesLoading") }}
        </div>
        <template v-if="formVarsReady">
          <VariablesValueSelector
            :key="`global-${formKey}`"
            scope="global"
            :variablesManager="formVars"
            :variablesConfig="{ list: formVars.variablesData.global }"
            :selectedTimeDate="timeObj"
            :showDynamicFilters="false"
            data-test="dashboards-public-links-panel-global-variables"
          />
          <div
            v-for="group in scopedGroups"
            :key="`${group.key}-${formKey}`"
            class="flex flex-col gap-1"
            :data-test="`dashboards-public-links-panel-${group.key}-variables`"
          >
            <div class="text-text-secondary text-xs">{{ group.label }}</div>
            <VariablesValueSelector
              :scope="group.scope"
              :tabId="group.tabId"
              :panelId="group.panelId"
              :variablesManager="formVars"
              :variablesConfig="{ list: group.vars }"
              :selectedTimeDate="timeObj"
              :showDynamicFilters="false"
            />
          </div>
        </template>
      </div>
    </div>

    <div
      v-else
      class="flex h-full min-h-0 flex-col gap-3"
      data-test="dashboards-public-links-panel-list"
    >
      <OTable
        class="min-h-0 flex-1"
        :data="filteredLinks"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :frame="false"
        pagination="client"
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
          <div class="flex items-center gap-2">
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="lastUpdatedAt || null"
              :loading="fetching"
              data-test="dashboards-public-links-panel-refresh-btn"
              @click="refetchLinks"
            />
            <OButton
              variant="primary"
              size="sm"
              data-test="dashboards-public-links-panel-new-btn"
              @click="openForm(null)"
            >
              {{ t("dashboard.publicLinks.newLink") }}
            </OButton>
          </div>
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
          <span class="text-text-body text-sm">{{
            hasRelativeRange(row)
              ? refreshLabel(row.rebuild_secs, t)
              : t("dashboard.publicLinks.refreshOnce")
          }}</span>
        </template>
        <template #cell-expires="{ row }">
          <PublicLinkExpiresCell
            :link="row"
            :timezone="timezone"
            :data-test="`dashboards-public-links-panel-${row.id}-expiry`"
          />
        </template>
        <template #cell-updated="{ row }">
          <OTimeCell :value="row.last_rebuilt_at" unit="us" :timezone="timezone" :now="now" />
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
              :aria-label="t('dashboard.publicDashboard.copyLink')"
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
              :aria-label="t('dashboard.publicLinks.openPublicPage')"
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
              :aria-label="t('dashboard.publicLinks.editSettings')"
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
              :aria-label="
                row.enabled ? t('dashboard.publicLinks.pause') : t('dashboard.publicLinks.resume')
              "
              :loading="busyRows.get(row.id) === 'inline'"
              :disabled="busyRows.has(row.id)"
              :data-test="`dashboards-public-links-panel-${row.id}-${row.enabled ? 'pause' : 'resume'}-btn`"
              @click="setPaused(row, row.enabled, 'inline')"
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
                  :aria-label="t('dashboard.moreActions')"
                  :loading="busyRows.get(row.id) === 'menu'"
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
                :disabled="busyRows.has(row.id)"
                :data-test="`dashboards-public-links-panel-${row.id}-${row.enabled ? 'pause' : 'resume'}-menu`"
                @select="setPaused(row, row.enabled, 'menu')"
              >
                {{
                  row.enabled ? t("dashboard.publicLinks.pause") : t("dashboard.publicLinks.resume")
                }}
              </ODropdownItem>
              <ODropdownItem
                v-if="canRebuild(row)"
                icon-left="refresh"
                :disabled="busyRows.has(row.id)"
                :data-test="`dashboards-public-links-panel-${row.id}-rebuild-menu`"
                @select="rebuildLink(row)"
              >
                {{ t("dashboard.publicLinks.rebuildNow") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete"
                variant="destructive"
                :disabled="busyRows.has(row.id)"
                :data-test="`dashboards-public-links-panel-${row.id}-revoke-menu`"
                @select="revokeLink(row)"
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
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query";
import { useNow } from "@/composables/useNow";
import { copyToClipboard } from "@/utils/clipboard";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import PublicLinkRangesCell from "./PublicLinkRangesCell.vue";
import PublicLinkExpiresCell from "./PublicLinkExpiresCell.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import VariablesValueSelector from "@/components/dashboards/VariablesValueSelector.vue";
import {
  useVariablesManager,
  type VariableConfig,
  type VariableRuntimeState,
} from "@/composables/dashboard/useVariablesManager";
import DateTime from "@/components/DateTime.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import type { PublicLink, PublicLinkRange } from "@/services/public_dashboards_admin";
import {
  publicLinksForDashboardQuery,
  rebuildPublicLinkMutation,
  revokePublicLinkMutation,
  savePublicLinkMutation,
  setPublicLinkPausedMutation,
} from "@/services/public_dashboards.queries";
import {
  REFRESH_SECONDS,
  expiryDate,
  makePublicLinkSchema,
  publicLinkDefaults,
  publicLinkFormFrom,
  MAX_RANGES,
  nextNewRange,
  pickerPeriod,
  rangeError,
  rangeFromPicker,
  rangeKey,
  todayIn,
  toPublicLinkConfig,
  type PickedTime,
  type PublicLinkForm,
} from "./PublicLinkForm.schema";
import {
  canRebuild,
  hasRelativeRange,
  longRange,
  publicLinkColumns,
  publicLinkSearchTerm,
  forbiddenMessage,
  publicLinkUrl as publicUrl,
  refreshLabel,
} from "./publicLinkDisplay";

type VariableValues = { values?: Array<{ name: string; value: unknown }> };
type DashboardLayout = {
  tabs?: Array<{ tabId: string; name?: string; panels?: Array<{ id: string; title?: string }> }>;
  variables?: Record<string, unknown>;
};
/** The live dashboard's variables manager, read to seed a new link with what the author sees. */
type DashboardVariables = { getUrlParams: () => Record<string, unknown> };
type PanelView = "list" | "form" | "created";
/** Where a row action was clicked, so the spinner shows on that control. */
type RowActionSource = "inline" | "menu";

interface PresetOption extends SelectOption {
  value: number;
}

interface RangeOption extends SelectOption {
  value: string;
}

interface RangeRow {
  id: number;
  range: PublicLinkRange;
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
    // Tabs and panels, so tab- and panel-scoped variables can be shown and frozen per scope.
    dashboardData?: DashboardLayout;
    dashboardVariables?: DashboardVariables | null;
    // Open straight on this link's edit form (from the org-wide list).
    editLinkId?: string;
  }>(),
  { modelValue: false },
);
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const store = useStore();
const { t } = useI18nTyped();
const { showErrorNotification, showPositiveNotification } = useNotifications();
const { confirm } = useConfirmDialog();
const orgId = useOrgId();
const now = useNow();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

// From a dashboard, leaving the form returns to its link list; from the org-wide list it closes the drawer.
function guardClose(): boolean {
  if (currentView.value === "list" || !links.value.length || props.editLinkId) return true;
  editing.value = null;
  form.reset(publicLinkDefaults());
  view.value = "list";
  return false;
}

const timezone = computed<string>(
  () => store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
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
  const q = publicLinkSearchTerm(searchQuery.value);
  if (!q) return links.value;
  return links.value.filter((link) =>
    [link.name, link.slug, link.published_by].some((v) => v.toLowerCase().includes(q)),
  );
});

const saveMutation = useMutation(() => savePublicLinkMutation(orgId.value));
const pauseMutation = useMutation(() => setPublicLinkPausedMutation(orgId.value));
const revokeMutation = useMutation(() => revokePublicLinkMutation(orgId.value));
const rebuildMutation = useMutation(() => rebuildPublicLinkMutation(orgId.value));

const view = ref<PanelView>("list");
const editing = ref<PublicLink | null>(null);
// The backend checks an expiry only when it changes, so an expired link stays editable until its date is touched.
const storedExpires = computed(() =>
  editing.value?.expires_at ? expiryDate(editing.value.expires_at, timezone.value) : "",
);
// The browser's own date check would otherwise block saving an expired link's unchanged date.
const expiresMin = computed(() =>
  storedExpires.value !== "" && storedExpires.value < today.value
    ? storedExpires.value
    : today.value,
);
const createdLink = ref<PublicLink | null>(null);
// Remounts the variable pickers so each form opens on its own seed.
const formKey = ref(0);
// Its own manager, so editing a link's values never changes the dashboard's selection.
const formVars = useVariablesManager(t);
const formVarsReady = ref(false);
// Saving before every picker has loaded would freeze whatever value a picker held mid-load.
const variablesPending = computed(
  () => !!props.variablesConfig?.list?.length && (!formVarsReady.value || formVars.isLoading.value),
);
// Rows with a pause, resume, rebuild or revoke in flight, so a second click can't send it again.
const busyRows = reactive(new Map<string, RowActionSource>());

// A dashboard with no links opens straight on the create form.
const currentView = computed<PanelView>(() =>
  view.value === "list" && linksQuery.isSuccess.value && !links.value.length ? "form" : view.value,
);

const drawerTitle = computed<I18nText>(() =>
  props.dashboardTitle
    ? t("dashboard.publicLinks.panelTitleFor", { name: raw(props.dashboardTitle) })
    : t("dashboard.publicLinks.panelTitle"),
);

const showBack = computed(() => !loadFailed.value && currentView.value !== "list");

const primaryLabel = computed<I18nText | undefined>(() => {
  if (loadFailed.value) return undefined;
  if (currentView.value === "form") {
    return editing.value
      ? t("dashboard.publicLinks.saveChanges")
      : t("dashboard.publicLinks.createLink");
  }
  return undefined;
});

const form = useOForm<PublicLinkForm>({
  defaultValues: publicLinkDefaults(),
  schema: makePublicLinkSchema(t, today.value, () => storedExpires.value),
  onSubmit: (value) => submit(value),
});
const ranges = form.useStore((s) => s.values.ranges);
// A duplicate row is still in the list until it's fixed, but is one choice.
const defaultOptions = computed<RangeOption[]>(() =>
  [...new Map(ranges.value.map((range) => [rangeKey(range), range])).entries()].map(
    ([value, range]) => ({ value, label: longRange(range, t, timezone.value) }),
  ),
);
// The form holds the ranges; rows give each a stable id, so a picker isn't remounted mid-pick.
let nextRowId = 0;
const rows = ref<RangeRow[]>([]);
watch(
  ranges,
  (list) => {
    const same =
      list.length === rows.value.length &&
      list.every((r, i) => rangeKey(r) === rangeKey(rows.value[i].range));
    if (!same) rows.value = list.map((range) => ({ id: nextRowId++, range }));
  },
  { immediate: true },
);
// A duplicate is flagged on the later row only.
const rowErrors = computed(() =>
  rows.value.map((row, i) =>
    rangeError(
      row.range,
      rows.value.slice(0, i).map((r) => r.range),
      Date.now() * 1000,
      t,
    ),
  ),
);
// An edited link keeps an interval the list doesn't offer, so saving doesn't silently change it.
const refreshOptions = computed<PresetOption[]>(() => {
  const own = editing.value?.rebuild_secs;
  const secs =
    own === undefined || REFRESH_SECONDS.includes(own)
      ? REFRESH_SECONDS
      : [...REFRESH_SECONDS, own].sort((a, b) => a - b);
  return secs.map((value) => ({ value, label: refreshLabel(value, t) }));
});

// One labelled picker per tab and per panel that has its own scoped variables.
const scopedGroups = computed(() => {
  if (!formVarsReady.value) return [];
  const tabs = props.dashboardData?.tabs ?? [];
  const panels = tabs.flatMap((tab) =>
    (tab.panels ?? []).map((panel) => ({ ...panel, tabId: tab.tabId })),
  );
  const tabGroups = Object.entries(formVars.variablesData.tabs)
    .filter(([, vars]) => vars.length)
    .map(([tabId, vars]) => ({
      key: `tab-${tabId}`,
      scope: "tabs" as const,
      tabId,
      panelId: undefined,
      vars,
      label: t("dashboard.publicLinks.tabVariables", {
        name: raw(tabs.find((tab) => tab.tabId === tabId)?.name ?? tabId),
      }),
    }));
  const panelGroups = Object.entries(formVars.variablesData.panels)
    .filter(([, vars]) => vars.length)
    .map(([panelId, vars]) => {
      const panel = panels.find((p) => p.id === panelId);
      return {
        key: `panel-${panelId}`,
        scope: "panels" as const,
        tabId: panel?.tabId,
        panelId,
        vars,
        label: t("dashboard.publicLinks.panelVariables", {
          name: raw(panel?.title || panelId),
        }),
      };
    });
  return [...tabGroups, ...panelGroups];
});

const columns = publicLinkColumns(t);

function syncRanges() {
  form.setFieldValue(
    "ranges",
    rows.value.map((r) => r.range),
  );
}

function onRangeChanged(row: RangeRow, value: PickedTime) {
  if (value.userChangedValue === false) return;
  row.range = rangeFromPicker(value);
  syncRanges();
}

function addRange() {
  rows.value.push({ id: nextRowId++, range: nextNewRange(rows.value.map((r) => r.range)) });
  syncRanges();
}

function removeRange(row: RangeRow) {
  rows.value = rows.value.filter((r) => r.id !== row.id);
  syncRanges();
}

// Expired and orphaned links can't be resumed, so they offer no pause toggle.
function canPause(link: PublicLink): boolean {
  return link.status !== "expired" && link.status !== "dashboard_deleted";
}

function serverMessage(e: unknown): I18nText {
  return raw((e as { response?: { data?: { message?: string } } })?.response?.data?.message);
}

// The list refetch the mutation started must land first, or the row still offers the action it just ran.
async function runRowAction(
  link: PublicLink,
  source: RowActionSource,
  run: () => Promise<void>,
  failed: I18nText = t("dashboard.publicLinks.actionFailed"),
) {
  if (busyRows.has(link.id)) return;
  busyRows.set(link.id, source);
  try {
    await run();
    await linksQuery.refetch({ cancelRefetch: false });
  } catch (e: unknown) {
    showErrorNotification(
      forbiddenMessage(e, t, t("dashboard.publicLinks.actionForbidden")) ??
        (serverMessage(e) || failed),
    );
  } finally {
    busyRows.delete(link.id);
  }
}

// Keys follow the dashboard URL: `name`, `name.t.<tabId>`, `name.p.<panelId>`.
function frozenVariables(): Record<string, unknown> {
  // Without the pickers (opened from the org list) an edit keeps the link's frozen values.
  if (!formVarsReady.value) return editing.value ? { ...editing.value.frozen_variables } : {};
  const out: Record<string, unknown> = {};
  const put = (vars: VariableRuntimeState[], suffix: string) =>
    vars.forEach((v) => {
      if (v.type !== "dynamic_filters") out[`${v.name}${suffix}`] = v.value;
    });
  put(formVars.variablesData.global, "");
  Object.entries(formVars.variablesData.tabs).forEach(([id, vars]) => put(vars, `.t.${id}`));
  Object.entries(formVars.variablesData.panels).forEach(([id, vars]) => put(vars, `.p.${id}`));
  return out;
}

// What the pickers start from, as URL-style params the manager already knows how to load.
function variableSeedParams(): Record<string, unknown> {
  if (editing.value) {
    return Object.fromEntries(
      Object.entries(editing.value.frozen_variables).map(([key, value]) => [`var-${key}`, value]),
    );
  }
  if (props.dashboardVariables) return props.dashboardVariables.getUrlParams();
  return Object.fromEntries(
    (props.currentValues?.values ?? [])
      .filter((v) => v?.name)
      .map((v) => [`var-${v.name}`, v.value]),
  );
}

// A seeded value counts as loaded, so an empty one would freeze a query variable at null without ever fetching.
function withoutEmptyQuerySeeds(
  params: Record<string, unknown>,
  list: VariableConfig[],
): Record<string, unknown> {
  const queryNames = new Set(list.filter((v) => v.type === "query_values").map((v) => v.name));
  const isEmpty = (value: unknown) =>
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => {
      const name = key.match(/^var-(.+)\.[tp]\..+$/)?.[1] ?? key.replace(/^var-/, "");
      return !(queryNames.has(name) && isEmpty(value));
    }),
  );
}

async function seedFormVariables() {
  formVarsReady.value = false;
  const list = (props.variablesConfig?.list ?? []) as VariableConfig[];
  if (!list.length) return;
  // Dynamic filters are never part of a public link.
  await formVars.initialize(list, {
    ...props.dashboardData,
    variables: { ...props.dashboardData?.variables, showDynamicFilters: false },
  });
  formVars.loadFromUrl({ query: withoutEmptyQuerySeeds(variableSeedParams(), list) });
  Object.keys(formVars.variablesData.tabs).forEach((id) => formVars.setTabVisibility(id, true));
  Object.keys(formVars.variablesData.panels).forEach((id) => formVars.setPanelVisibility(id, true));
  formVarsReady.value = true;
}

function openForm(link: PublicLink | null) {
  editing.value = link;
  formKey.value += 1;
  form.reset(link ? publicLinkFormFrom(link, timezone.value) : publicLinkDefaults());
  view.value = "form";
}

function goBack() {
  if (currentView.value === "created") view.value = "list";
  else closeForm();
}

function closeForm() {
  editing.value = null;
  form.reset(publicLinkDefaults());
  // Opened to edit one link from the org-wide list, so leaving the form returns there.
  if (links.value.length && !props.editLinkId) view.value = "list";
  else open.value = false;
}

async function submit(value: PublicLinkForm) {
  if (variablesPending.value) return;
  try {
    const saved = await saveMutation.mutateAsync({
      dashboardId: props.dashboardId,
      linkId: editing.value?.id,
      config: toPublicLinkConfig(
        value,
        frozenVariables(),
        timezone.value,
        editing.value?.expires_at ?? null,
      ),
    });
    if (editing.value) {
      showPositiveNotification(t("dashboard.publicLinks.savedToast"));
      closeForm();
    } else {
      createdLink.value = saved;
      view.value = "created";
    }
  } catch (e: unknown) {
    const refused = forbiddenMessage(
      e,
      t,
      editing.value
        ? t("dashboard.publicLinks.editForbidden")
        : t("dashboard.publicLinks.createForbidden"),
    );
    showErrorNotification(
      refused ?? (serverMessage(e) || t("dashboard.publicDashboard.publishFailed")),
    );
  }
}

function setPaused(link: PublicLink, paused: boolean, source: RowActionSource) {
  return runRowAction(link, source, async () => {
    await pauseMutation.mutateAsync({ link, paused });
    showPositiveNotification(
      paused ? t("dashboard.publicLinks.pausedToast") : t("dashboard.publicLinks.resumedToast"),
    );
  });
}

function rebuildLink(link: PublicLink) {
  return runRowAction(link, "menu", async () => {
    await rebuildMutation.mutateAsync(link);
    showPositiveNotification(t("dashboard.publicLinks.rebuiltToast"));
  });
}

async function revokeLink(link: PublicLink) {
  const ok = await confirm({
    title: t("dashboard.publicLinks.revokeTitle", {
      name: link.name ? raw(link.name) : t("dashboard.publicLinks.untitled"),
    }),
    message: t("dashboard.publicLinks.revokeMessage"),
    confirmLabel: t("dashboard.publicDashboard.revoke"),
    cancelLabel: t("common.cancel"),
    destructive: true,
  });
  if (!ok) return;
  await runRowAction(
    link,
    "menu",
    async () => {
      await revokeMutation.mutateAsync(link);
      showPositiveNotification(t("dashboard.publicDashboard.revokedToast"));
    },
    t("dashboard.publicDashboard.revokeFailed"),
  );
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
// The link to open once the list has it; set on every opening so a stale view can't skip it.
const pendingEditId = ref<string | null>(null);

watch(
  () => [open.value, props.editLinkId] as const,
  ([isOpen, editId], previous) => {
    if (!isOpen) return;
    // Opening resets the panel; a new editLinkId while open only switches the link.
    if (!previous?.[0]) {
      view.value = "list";
      editing.value = null;
      createdLink.value = null;
      // A dashboard with no links opens straight on the form, so errors from an earlier attempt must not carry over.
      form.reset(publicLinkDefaults());
    }
    pendingEditId.value = editId ?? null;
  },
  { immediate: true },
);
// Each time the form opens, its pickers start again from the link or the dashboard.
watch(
  () => (currentView.value === "form" ? formKey.value : null),
  (session) => {
    if (session !== null) seedFormVariables();
  },
  { immediate: true },
);
watch(defaultOptions, (options) => {
  const first = options[0];
  if (first && !options.some((o) => o.value === form.state.values.defaultKey)) {
    form.setFieldValue("defaultKey", first.value);
  }
});
watch(
  () => [pendingEditId.value, links.value] as const,
  ([editId, list]) => {
    if (!editId) return;
    const link = list.find((l) => l.id === editId);
    if (!link) return;
    pendingEditId.value = null;
    openForm(link);
  },
  { immediate: true },
);
</script>
