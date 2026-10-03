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
  <div class="flex h-full min-h-0 flex-col" data-test="rum-analytics-events-list">
    <OBanner
      v-if="permission === 'read'"
      variant="warning"
      dense
      class="mx-page-edge mt-2"
      :content="t('rum.analytics.events.readOnly')"
      data-test="rum-analytics-named-events-read-only"
    />
    <OBanner
      v-if="invalidCount > 0"
      variant="warning"
      dense
      class="mx-page-edge mt-2"
      :content="t('rum.analytics.events.unreadable', { count: invalidCount }, invalidCount)"
      data-test="rum-analytics-named-events-unreadable"
    />
    <OBanner
      v-if="status === 'failed' && events.length > 0"
      variant="warning"
      dense
      class="mx-page-edge mt-2"
      :content="t('rum.analytics.events.loadFailed')"
      data-test="rum-analytics-named-events-stale"
    >
      <template #actions>
        <OButton
          variant="ghost"
          size="sm"
          data-test="rum-analytics-named-events-retry-btn"
          @click="refresh"
          >{{ t("common.retry") }}</OButton
        >
      </template>
    </OBanner>
    <div class="min-h-0 flex-1 overflow-hidden">
      <OTable
        v-model:selected-ids="selectedIds"
        :frame="false"
        :data="filtered"
        :columns="columns"
        row-key="id"
        :loading="status === 'loading'"
        :forbidden="status === 'forbidden'"
        selection="multiple"
        :is-row-selectable="() => canWrite"
        pagination="client"
        :page-size="20"
        :page-size-options="[20, 50]"
        sorting="client"
        :default-columns="false"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="rum-analytics-named-events"
        :enable-column-resize="true"
        data-test="rum-analytics-named-events-table"
        @row-click="(row: NamedEvent) => openEdit(row)"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
            <OSearchInput
              v-model="filter"
              class="min-w-0 flex-1 max-md:min-w-40"
              :placeholder="t('rum.analytics.events.search')"
              clearable
              data-test="rum-analytics-named-events-search"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :loading="loading"
            data-test="rum-analytics-named-events-refresh-btn"
            @click="refresh"
          />
        </template>
        <template #empty>
          <OEmptyState
            v-if="status === 'failed'"
            size="hero"
            preset="load-error"
            :description="t('rum.analytics.events.loadFailed')"
            data-test="rum-analytics-named-events-load-error"
            @action="refresh"
          />
          <OEmptyState
            v-else
            size="hero"
            preset="no-named-events"
            :filtered="!!filter.trim()"
            :actions="canCreate ? undefined : []"
            data-test="rum-analytics-named-events-empty"
            @action="onEmptyAction"
          />
        </template>
        <template #cell-name="{ row, index }">
          <span
            class="text-text-body truncate font-medium"
            :data-test="`rum-analytics-named-events-row-${index}`"
            >{{ row.name }}</span
          >
        </template>
        <template #cell-rules="{ row, index }">
          <span
            class="text-text-secondary truncate"
            :data-test="`rum-analytics-named-events-row-${index}-rules`"
            >{{ summary(row) }}</span
          >
        </template>
        <template #cell-usedBy="{ row, index }">
          <span
            :class="usage(row) ? 'text-text-body' : 'text-text-muted'"
            :data-test="`rum-analytics-named-events-row-${index}-used-by`"
            >{{
              usage(row)
                ? t("rum.analytics.events.usedByCount", { count: usage(row) }, usage(row) ?? 0)
                : ABSENT
            }}</span
          >
        </template>
        <template #cell-updated="{ row }">
          <span class="flex min-w-0 items-baseline gap-1.5">
            <OTimeCell :value="row.updatedAt" unit="ms" :timezone="store.state.timezone" />
            <span class="text-text-secondary truncate text-xs">{{ row.updatedBy }}</span>
          </span>
        </template>
        <template #cell-actions="{ row, index }">
          <div class="flex items-center justify-end gap-0.5" @click.stop>
            <span class="max-md:hidden">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :disabled="!canWrite"
                :aria-label="t('rum.analytics.events.edit')"
                :data-test="`rum-analytics-named-events-row-${index}-edit-btn`"
                @click="openEdit(row)"
              />
              <OTooltip :content="canWrite ? t('rum.analytics.events.edit') : readOnlyTip" />
            </span>
            <span class="max-md:hidden">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="content-copy"
                :disabled="!canCreate"
                :aria-label="t('rum.analytics.events.duplicate')"
                :data-test="`rum-analytics-named-events-row-${index}-duplicate-btn`"
                @click="duplicate(row)"
              />
              <OTooltip :content="duplicateTip" />
            </span>
            <span class="max-md:hidden">
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :disabled="!canWrite"
                :aria-label="t('rum.analytics.events.delete')"
                :data-test="`rum-analytics-named-events-row-${index}-delete-btn`"
                @click="remove(row)"
              />
              <OTooltip :content="canWrite ? t('rum.analytics.events.delete') : readOnlyTip" />
            </span>
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  icon-left="more-vert"
                  variant="ghost"
                  size="icon-xs-sq"
                  class="md:hidden"
                  :aria-label="t('rum.analytics.events.moreActions')"
                  :data-test="`rum-analytics-named-events-row-${index}-more-btn`"
                  @click.stop
                />
              </template>
              <ODropdownItem
                icon-left="edit"
                class="md:hidden"
                :disabled="!canWrite"
                :data-test="`rum-analytics-named-events-row-${index}-edit-btn-menu`"
                @select="openEdit(row)"
              >
                <span>{{ t("rum.analytics.events.edit") }}</span>
              </ODropdownItem>
              <ODropdownItem
                icon-left="content-copy"
                class="md:hidden"
                :disabled="!canCreate"
                :data-test="`rum-analytics-named-events-row-${index}-duplicate-btn-menu`"
                @select="duplicate(row)"
              >
                <span>{{ t("rum.analytics.events.duplicate") }}</span>
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete"
                variant="destructive"
                class="md:hidden"
                :disabled="!canWrite"
                :data-test="`rum-analytics-named-events-row-${index}-delete-btn-menu`"
                @select="remove(row)"
              >
                <span>{{ t("rum.analytics.events.delete") }}</span>
              </ODropdownItem>
            </ODropdown>
          </div>
        </template>
        <template #selection-actions>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            :loading="bulkDeleting"
            data-test="rum-analytics-named-events-bulk-delete-btn"
            @click="removeSelected"
          >
            {{ t("rum.analytics.events.delete") }}
          </OButton>
        </template>
        <template v-if="status === 'ready'" #footer-note>
          <span class="max-md:hidden" data-test="rum-analytics-named-events-cap">{{
            t("rum.analytics.events.capUsage", { count: events.length, max: MAX_EVENTS_PER_APP })
          }}</span>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter, type HistoryState } from "vue-router";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import useNamedEvents, {
  namedEventHandoffState,
  type FunnelUsage,
} from "@/composables/rum/useNamedEvents";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { MAX_EVENTS_PER_APP, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";

defineOptions({ name: "NamedEventsListPage" });

const ABSENT = raw("—");

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const pa = useProductAnalytics();
const ne = useNamedEvents();
const savedFunnels = useSavedFunnels();
const { confirm } = useConfirmDialog();
const { events, permission, invalidCount, loading } = ne;

const filter = ref("");
const selectedIds = ref<string[]>([]);
const bulkDeleting = ref(false);

const org = (): string => store.state.selectedOrganization?.identifier ?? "";
const app = computed(() => pa.state.app);
const status = computed(() => ne.status(org(), app.value));
const canWrite = computed(() => permission.value === "write");
const canCreate = computed(() => canWrite.value && events.value.length < MAX_EVENTS_PER_APP);
const readOnlyTip = computed(() => t("rum.analytics.events.readOnly"));
const duplicateTip = computed<I18nText>(() => {
  if (!canWrite.value) return readOnlyTip.value;
  if (!canCreate.value) return t("rum.analytics.events.capReached", { max: MAX_EVENTS_PER_APP });
  return t("rum.analytics.events.duplicate");
});

const filtered = computed(() => {
  const term = filter.value.trim().toLowerCase();
  return term ? events.value.filter((e) => e.name.toLowerCase().includes(term)) : [...events.value];
});

// Only a ready funnel list can say "no funnel uses this"; until then the count stays absent.
const usageCounts = computed<Record<string, number> | null>(() => {
  if (savedFunnels.status(org(), app.value) !== "ready") return null;
  const counts: Record<string, number> = {};
  for (const f of savedFunnels.funnels.value)
    for (const id of new Set(f.eventIds)) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
});
const usage = (ev: NamedEvent): number | null => usageCounts.value?.[ev.id] ?? null;

const columns = computed<OTableColumnDef<NamedEvent>[]>(() => [
  {
    id: "name",
    header: t("rum.analytics.events.name"),
    accessorKey: "name",
    size: 220,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "rules",
    header: t("rum.analytics.events.rules"),
    size: 320,
    meta: { autoWidth: true, fillRemaining: true },
  },
  {
    id: "usedBy",
    header: t("rum.analytics.events.usedBy"),
    accessorFn: (row) => usage(row) ?? 0,
    size: 120,
    sortable: true,
    hideable: true,
  },
  {
    id: "updated",
    header: t("rum.analytics.events.updated"),
    accessorKey: "updatedAt",
    size: 220,
    sortable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: raw(""),
    isAction: true,
    meta: { align: "right", actionCount: 3 },
  },
]);

const summary = (ev: NamedEvent): I18nText =>
  raw(
    ev.rules
      .map((r) => {
        if (r.t === "action") {
          const targets = raw(r.targets.join(", "));
          return r.onPage
            ? t("rum.analytics.events.summaryClickOn", { targets, page: raw(r.onPage) })
            : t("rum.analytics.events.summaryClick", { targets });
        }
        const key =
          r.op === "eq" ? "summaryEq" : r.op === "prefix" ? "summaryPrefix" : "summaryRegex";
        return t(`rum.analytics.events.${key}`, { value: raw(r.value) });
      })
      .join(" · "),
  );

const load = (force = false) => {
  if (!app.value) return;
  if (force) {
    void ne.load(org(), app.value, true);
    void savedFunnels.load(org(), app.value, true, true);
    return;
  }
  void ne.ensure(org(), app.value);
  void savedFunnels.ensure(org(), app.value, false, true);
};

const refresh = () => load(true);

const openNew = (state?: HistoryState) =>
  router.push({ name: PA_ROUTES.eventNew, query: pa.toQuery(), state });

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") filter.value = "";
  else void openNew();
};

const openEdit = (ev: NamedEvent) => {
  if (!canWrite.value) return;
  void router.push({ name: PA_ROUTES.eventEdit, params: { id: ev.id }, query: pa.toQuery() });
};

const duplicate = (ev: NamedEvent) => {
  if (!canCreate.value) return;
  const name = t("rum.analytics.events.copyName", { name: raw(ev.name) });
  void openNew(namedEventHandoffState({ draft: { name, rules: ev.rules } }));
};

const funnelNames = (funnels: FunnelUsage[]) =>
  raw([...new Set(funnels.map((f) => f.name))].join(", "));

/** Resolves true only once the event is gone, so a cancel or a failure keeps the row's selection. */
const confirmRemove = async (ev: NamedEvent, funnels: FunnelUsage[]): Promise<boolean> => {
  const ok = await confirm({
    title: t("rum.analytics.events.deleteTitle"),
    message: funnels.length
      ? t(
          "rum.analytics.events.deleteInUseMessage",
          { name: raw(ev.name), count: funnels.length, names: funnelNames(funnels) },
          funnels.length,
        )
      : t("rum.analytics.events.deleteMessage", { name: raw(ev.name) }),
    confirmLabel: t("rum.analytics.events.delete"),
  });
  if (!ok) return false;
  try {
    const inUse = await ne.remove(org(), app.value, ev.id, funnels.length > 0);
    // A funnel saved with this event after the usage check: ask again, naming it.
    if (inUse) return confirmRemove(ev, inUse);
    return true;
  } catch {
    // useNamedEvents has already toasted, read-only included.
    return false;
  }
};

const remove = async (ev: NamedEvent) => {
  const funnels = await ne.usages(org(), app.value, ev.id).catch(() => []);
  if (await confirmRemove(ev, funnels))
    selectedIds.value = selectedIds.value.filter((id) => id !== ev.id);
};

type InUse = { ev: NamedEvent; funnels: FunnelUsage[] };

const inUseNames = (rows: InUse[]) =>
  raw(rows.map(({ ev, funnels }) => `${ev.name} (${funnelNames(funnels)})`).join("; "));

const confirmBulk = (count: number, inUse: InUse[]) =>
  confirm({
    title: t("rum.analytics.events.bulkDeleteTitle"),
    message: inUse.length
      ? t("rum.analytics.events.bulkDeleteInUseMessage", { count, names: inUseNames(inUse) }, count)
      : t("rum.analytics.events.bulkDeleteMessage", { count }, count),
    confirmLabel: t("rum.analytics.events.delete"),
  });

// A funnel saved with an event after the usage check refuses its delete: confirm those once more, then force.
const deleteChosen = async (chosen: NamedEvent[], inUse: InUse[]): Promise<string[]> => {
  const ids = chosen.map((e) => e.id);
  const first = await ne.removeMany(
    org(),
    app.value,
    ids,
    inUse.map((u) => u.ev.id),
  );
  const late = first.inUse.flatMap(({ id, funnels }) => {
    const ev = chosen.find((e) => e.id === id);
    return ev ? [{ ev, funnels }] : [];
  });
  if (!late.length || !(await confirmBulk(late.length, late))) return first.gone;
  const lateIds = late.map((u) => u.ev.id);
  const second = await ne.removeMany(org(), app.value, lateIds, lateIds);
  return [...first.gone, ...second.gone];
};

const removeSelected = async () => {
  const chosen = events.value.filter((e) => selectedIds.value.includes(e.id));
  if (!chosen.length) return;
  bulkDeleting.value = true;
  try {
    const used = await Promise.all(
      chosen.map((e) => ne.usages(org(), app.value, e.id).catch(() => [] as FunnelUsage[])),
    );
    const inUse = chosen.map((ev, i) => ({ ev, funnels: used[i] })).filter((u) => u.funnels.length);
    if (!(await confirmBulk(chosen.length, inUse))) return;
    const gone = await deleteChosen(chosen, inUse);
    selectedIds.value = selectedIds.value.filter((id) => !gone.includes(id));
  } finally {
    bulkDeleting.value = false;
  }
};

watch(app, () => load(), { immediate: true });
watch(app, () => {
  selectedIds.value = [];
  filter.value = "";
});
</script>
