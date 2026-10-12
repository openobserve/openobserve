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
  <div class="flex h-full min-h-0 flex-col" data-test="rum-analytics-saved-funnels-page">
    <div
      v-if="listStatus === 'forbidden' || permission === 'read' || invalidCount > 0"
      class="px-page-edge flex shrink-0 flex-col gap-2 pt-2"
    >
      <OBanner
        v-if="listStatus === 'forbidden'"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.noAccess')"
        data-test="rum-analytics-funnel-saved-no-access"
      />
      <OBanner
        v-if="permission === 'read'"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.readOnly')"
        data-test="rum-analytics-saved-funnels-read-only"
      />
      <OBanner
        v-if="invalidCount > 0"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.unreadable', { count: invalidCount }, invalidCount)"
        data-test="rum-analytics-funnel-saved-unreadable"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <OTable
        v-model:selected-ids="selectedIds"
        :data="rows"
        :columns="columns"
        row-key="id"
        :loading="listStatus === 'loading'"
        :forbidden="listStatus === 'forbidden'"
        :error="listStatus === 'failed' ? t('rum.analytics.saved.loadFailed') : null"
        :selection="canWrite ? 'multiple' : 'none'"
        pagination="client"
        :page-size="20"
        :page-size-options="[20, 50, 100]"
        sorting="client"
        :default-columns="false"
        :show-global-filter="false"
        :frame="false"
        table-id="rum-analytics-saved-funnels"
        :persist-columns="true"
        data-test="rum-analytics-saved-funnels-table"
        @row-click="(row) => draft.openSaved(row)"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
            <OSearchInput
              v-model="filter"
              class="min-w-0 flex-1 max-md:min-w-40"
              :placeholder="t('rum.analytics.saved.search')"
              clearable
              data-test="rum-analytics-saved-funnels-search"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastUpdatedAt"
            :loading="refreshing"
            data-test="rum-analytics-saved-funnels-refresh"
            @click="refresh"
          />
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-saved-funnels"
            :filtered="!!filter"
            @action="(id) => (id === 'clear-filters' ? (filter = '') : draft.startNew())"
          >
            <template v-if="!filter" #extra>
              <FunnelQuickStarts
                :entries="entries"
                :entries-loading="entriesLoading"
                :entries-failed="entriesFailed"
                :recent="recent"
                :events="events"
                @start="(steps) => draft.startNew({ ...emptyFunnel(), steps })"
                @open="(d) => draft.startNew(d)"
                @retry="loadEntries"
              />
            </template>
          </OEmptyState>
        </template>
        <template #error="{ message }">
          <OBanner
            variant="error"
            dense
            :content="raw(message)"
            data-test="rum-analytics-saved-funnels-error"
          >
            <template #actions>
              <OButton
                variant="ghost"
                size="sm"
                data-test="rum-analytics-saved-funnels-retry-btn"
                @click="refresh"
                >{{ t("common.retry") }}</OButton
              >
            </template>
          </OBanner>
        </template>
        <template #cell-name="{ row, index }">
          <span class="flex min-w-0 items-center gap-1.5">
            <span
              class="text-text-body truncate font-medium"
              :data-test="`rum-analytics-saved-funnel-row-${index}`"
              >{{ row.name }}</span
            >
            <OTag
              v-if="row.id === openedId"
              :label="t('rum.analytics.saved.current')"
              variant="primary-soft"
              size="xs"
              :data-test="`rum-analytics-saved-funnel-row-${index}-current`"
            />
          </span>
        </template>
        <template #cell-steps="{ row }">
          <KeySequence
            :keys="row.def.steps"
            :events="events"
            :events-ready="eventsReady"
            :max="MAX_SHOWN_STEPS"
            data-test="rum-analytics-saved-funnel-steps"
          />
        </template>
        <template #cell-updated="{ row }">
          <span class="flex min-w-0 flex-col text-xs">
            <OTimeCell :value="row.updatedAt" unit="ms" :timezone="store.state.timezone" />
            <span class="text-text-secondary truncate">{{ row.updatedBy }}</span>
          </span>
        </template>
        <template #cell-actions="{ row, index }">
          <span class="flex items-center justify-end gap-0.5" @click.stop>
            <span class="max-md:hidden">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :disabled="!canWrite"
                :aria-label="canWrite ? t('rum.analytics.saved.rename') : readOnlyTip"
                :data-test="`rum-analytics-saved-funnel-row-${index}-rename`"
                @click="dialogs?.rename(row)"
              />
              <OTooltip :content="canWrite ? t('rum.analytics.saved.rename') : readOnlyTip" />
            </span>
            <span class="max-md:hidden">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="content-copy"
                :disabled="!!duplicateBlocked(row)"
                :aria-label="duplicateBlocked(row) ?? t('rum.analytics.saved.duplicate')"
                :data-test="`rum-analytics-saved-funnel-row-${index}-duplicate`"
                @click="dialogs?.duplicate(row, true)"
              />
              <OTooltip :content="duplicateBlocked(row) ?? t('rum.analytics.saved.duplicate')" />
            </span>
            <span class="max-md:hidden">
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :disabled="!canWrite"
                :aria-label="canWrite ? t('rum.analytics.saved.delete') : readOnlyTip"
                :data-test="`rum-analytics-saved-funnel-row-${index}-delete`"
                @click="dialogs?.remove(row)"
              />
              <OTooltip :content="canWrite ? t('rum.analytics.saved.delete') : readOnlyTip" />
            </span>
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="more-vert"
                  class="md:hidden"
                  :aria-label="t('rum.analytics.saved.more')"
                  :data-test="`rum-analytics-saved-funnel-row-${index}-menu`"
                />
              </template>
              <ODropdownItem
                icon-left="edit"
                class="md:hidden"
                :disabled="!canWrite"
                :data-test="`rum-analytics-saved-funnel-row-${index}-rename-menu`"
                @select="dialogs?.rename(row)"
                >{{ t("rum.analytics.saved.rename") }}</ODropdownItem
              >
              <ODropdownItem
                icon-left="content-copy"
                class="md:hidden"
                :disabled="!!duplicateBlocked(row)"
                :data-test="`rum-analytics-saved-funnel-row-${index}-duplicate-menu`"
                @select="dialogs?.duplicate(row, true)"
                >{{ t("rum.analytics.saved.duplicate") }}</ODropdownItem
              >
              <ODropdownItem
                variant="destructive"
                icon-left="delete"
                class="md:hidden"
                :disabled="!canWrite"
                :data-test="`rum-analytics-saved-funnel-row-${index}-delete-menu`"
                @select="dialogs?.remove(row)"
                >{{ t("rum.analytics.saved.delete") }}</ODropdownItem
              >
            </ODropdown>
          </span>
        </template>
        <template #selection-actions>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            data-test="rum-analytics-saved-funnels-bulk-delete-btn"
            @click="removeSelected"
            >{{ t("rum.analytics.saved.delete") }}</OButton
          >
        </template>
      </OTable>
    </div>
    <SavedFunnelDialogs ref="dialogs" :events="events" :events-ready="eventsReady" />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import KeySequence from "@/components/rum/productAnalytics/KeySequence.vue";
import FunnelQuickStarts from "@/components/rum/productAnalytics/FunnelQuickStarts.vue";
import SavedFunnelDialogs from "@/components/rum/productAnalytics/SavedFunnelDialogs.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import useFunnelQuickStarts from "@/composables/rum/useFunnelQuickStarts";
import useFunnelDraft, {
  emptyFunnel,
  forwardFunnelLink,
  hasDeletedStep,
} from "@/composables/rum/useFunnelDraft";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  MAX_FUNNELS_PER_APP,
  type NamedEvent,
  type SavedFunnel,
} from "@/utils/rum/productAnalyticsModel";

defineOptions({ name: "SavedFunnelsPage", beforeRouteEnter: forwardFunnelLink });

const MAX_SHOWN_STEPS = 4;

const { t } = useI18nTyped();
const store = useStore();
const pa = useProductAnalytics();
const sf = useSavedFunnels();
const namedEvents = useNamedEvents();
const draft = useFunnelDraft();
const { permission, invalidCount } = sf;

const dialogs = ref<InstanceType<typeof SavedFunnelDialogs> | null>(null);
const filter = ref("");
const selectedIds = ref<string[]>([]);
const refreshing = ref(false);
let activatedOnce = false;

const events = computed<NamedEvent[]>(() => [...namedEvents.events.value]);
const eventsReady = computed(() => pa.eventsStatus.value === "ready");
const { entries, entriesLoading, entriesFailed, recent, loadEntries, refreshRecent } =
  useFunnelQuickStarts(() => events.value);

const org = () => pa.toQuery().org_identifier as string;
const listStatus = computed(() => sf.status(org(), pa.state.app));
// Another app's read time must not stand for this list while it loads.
const lastUpdatedAt = computed(() =>
  listStatus.value === "loading" ? undefined : (sf.loadedAt.value ?? undefined),
);
const canWrite = computed(() => permission.value === "write");
const openedId = computed(() => pa.openedFunnel.value?.id ?? null);
const readOnlyTip = computed(() => t("rum.analytics.saved.readOnly"));

const rows = computed(() => {
  const term = filter.value.trim().toLowerCase();
  const all = [...sf.funnels.value];
  return term ? all.filter((f) => f.name.toLowerCase().includes(term)) : all;
});

const columns = computed<OTableColumnDef<SavedFunnel>[]>(() => [
  {
    id: "name",
    header: t("rum.analytics.saved.name"),
    accessorKey: "name",
    sortable: true,
    size: 240,
  },
  {
    id: "steps",
    header: t("rum.analytics.saved.steps"),
    sortable: false,
    size: 360,
    meta: { autoWidth: true, fillRemaining: true },
  },
  {
    id: "updated",
    header: t("rum.analytics.saved.updated"),
    accessorKey: "updatedAt",
    sortable: true,
    hideable: true,
    size: 200,
  },
  {
    id: "actions",
    header: t("rum.analytics.saved.actions"),
    isAction: true,
    pinned: "right",
    size: 120,
    meta: { align: "center", actionCount: 3 },
  },
]);

// A copy is a create, so it waits on the same limits as Save as.
const duplicateBlocked = (f: SavedFunnel): I18nText | null => {
  if (!canWrite.value) return readOnlyTip.value;
  if (hasDeletedStep(f.def, events.value, eventsReady.value)) {
    return t("rum.analytics.saved.deletedStepFirst");
  }
  if (sf.funnels.value.length >= MAX_FUNNELS_PER_APP) {
    return t("rum.analytics.saved.capReached", { max: MAX_FUNNELS_PER_APP });
  }
  return null;
};

const removeSelected = async () => {
  const ids = new Set(selectedIds.value);
  const gone = await dialogs.value?.removeMany(sf.funnels.value.filter((f) => ids.has(f.id)));
  if (gone?.length) selectedIds.value = selectedIds.value.filter((id) => !gone.includes(id));
};

const refresh = async () => {
  refreshing.value = true;
  try {
    await sf.load(org(), pa.state.app, true);
  } finally {
    refreshing.value = false;
  }
};

const load = async () => {
  await pa.loadScope();
  const app = pa.state.app;
  if (!app) return;
  await sf.ensure(org(), app);
  await pa.eventsGate(() => true);
  refreshRecent();
};

// The quick starts only show for an app with no saved funnels, so their reads wait for that.
watch(
  () =>
    [
      listStatus.value,
      sf.funnels.value.length,
      pa.scopeStatus.value,
      pa.refreshTick.value,
    ] as const,
  ([status, count, scope]) => {
    if (status === "ready" && count === 0 && scope === "ok") void loadEntries();
  },
  { immediate: true },
);
watch(
  () => pa.state.app,
  (app, prev) => {
    if (app && app !== prev) void load();
  },
);
watch(eventsReady, (ready) => ready && refreshRecent());

onMounted(() => void load());
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  void load();
});
</script>
