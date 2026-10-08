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
  <div data-test="edit-role-module-pane" class="flex min-h-0 min-w-0 flex-1 flex-col">
    <OPageHeader
      :title="trail[trail.length - 1]"
      title-data-test="edit-role-module-pane-title"
      :icon="backTarget ? undefined : icon"
      :back="backTarget"
    >
      <template #title-trail>
        <OBadge v-if="grantedRowCount" variant="primary-soft" size="sm">
          {{ t("iam.editRole.moduleGrantedCount", { count: grantedRowCount }) }}
        </OBadge>
        <OBadge
          v-if="added"
          variant="success-soft"
          size="sm"
          data-test="edit-role-module-pane-added"
        >
          {{ t("iam.editRole.modulePendingAdded", { count: added }) }}
        </OBadge>
        <OBadge
          v-if="removed"
          variant="error-soft"
          size="sm"
          data-test="edit-role-module-pane-removed"
        >
          {{ t("iam.editRole.modulePendingRemoved", { count: removed }) }}
        </OBadge>
      </template>
      <template #actions>
        <slot name="actions" />
      </template>
    </OPageHeader>

    <div
      v-if="listsResources && entities.length"
      class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2"
    >
      <OSearchInput
        :model-value="query"
        clearable
        class="w-72 max-md:w-full"
        :placeholder="
          listsModules ? t('iam.editRole.filterModules') : t('iam.editRole.searchModuleResources')
        "
        data-test="edit-role-module-pane-search"
        @update:model-value="(value) => setFilter(String(value ?? ''), scope)"
      />
      <OToggleGroup
        :model-value="scope"
        @update:model-value="(value) => setFilter(query, String(value ?? 'all'))"
      >
        <OToggleGroupItem value="all" size="sm" data-test="edit-role-module-pane-filter-all">
          {{ t("iam.editRole.moduleScopeAll") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="granted"
          size="sm"
          data-test="edit-role-module-pane-filter-granted"
        >
          {{ t("iam.editRole.moduleScopeGranted") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- One table for scopes and resources: two tables size their columns independently and drift out of line. -->
    <div class="flex min-h-0 flex-1 flex-col" data-test="edit-role-module-pane-resources">
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="rowKey"
        :default-columns="false"
        :show-global-filter="false"
        :row-class="(row: PaneRow) => (row.kind === 'scope' ? 'bg-surface-subtle' : '')"
        dense
        :fill-height="!noResources"
        :key="paginationMode"
        :pagination="paginationMode"
        :current-page="currentPage"
        :page-size="pageSize"
        :page-size-options="[25, 50, 100]"
        :total-count="filteredEntities.length"
        sorting="none"
        :loading="loading"
        @pagination-change="onPaginationChange"
      >
        <template #cell-label="{ row }">
          <div
            v-if="row.kind === 'scope'"
            class="flex min-w-0 flex-col py-0.5"
            :data-test="`edit-role-module-pane-scope-row-${row.key}`"
          >
            <OTruncatedText class="text-text-heading font-medium">{{ row.label }}</OTruncatedText>
            <OTruncatedText class="text-text-secondary text-xs">{{ row.hint }}</OTruncatedText>
          </div>
          <div
            v-else-if="listsModules || (row.node.has_entities && row.node.childName)"
            class="flex min-w-0 items-center gap-1"
          >
            <OButton
              variant="ghost-primary"
              size="sm"
              icon-right="chevron-right"
              class="min-w-0"
              :data-test="`edit-role-module-pane-open-${row.node.name}`"
              @click="emit('open', row.node)"
            >
              <OTruncatedText class="block">{{ row.node.display_name }}</OTruncatedText>
            </OButton>
            <OTooltip
              v-if="insideOf(row.node).count"
              :content="insideHint(insideOf(row.node))"
              side="right"
            >
              <OBadge
                variant="default-soft"
                size="sm"
                tabindex="0"
                :data-test="`edit-role-module-pane-inside-${row.node.name}`"
              >
                {{ t("iam.editRole.grantedInsideCount", { count: insideOf(row.node).count }) }}
              </OBadge>
            </OTooltip>
          </div>
          <span v-else>
            {{ row.node.display_name }}
          </span>
        </template>
        <template v-for="action in ACTIONS" :key="action" #[`cell-${action}`]="{ row }">
          <OCheckbox
            v-if="row.node.permission?.[action]?.show"
            :model-value="isChecked(row.node, row.resource, action, row.depth)"
            :disabled="loading || lockedByWiderScope(row.node, row.resource, action, row.depth)"
            :title="checkboxHint(row.node, row.resource, action, row.depth)"
            :data-test="checkboxTest(row, action)"
            @update:model-value="(value) => change(row.node, action, !!value)"
          />
          <!-- A dash, not a disabled box: a disabled box already means "granted by a wider scope". -->
          <span
            v-else
            class="text-text-secondary"
            :title="t('iam.editRole.actionNotApplicable')"
            :data-test="`${checkboxTest(row, action)}-na`"
          >
            {{ raw("—") }}
          </span>
        </template>
      </OTable>
      <!-- The scope rows above stay editable, so the empty state names what they still cover. -->
      <OEmptyState
        v-if="noResources"
        class="flex-1"
        size="block"
        preset="no-data"
        hide-action
        :title="t('iam.editRole.moduleHasNoResources')"
        :description="t('iam.editRole.moduleHasNoResourcesHint')"
        data-test="edit-role-module-pane-no-resources"
      />
    </div>

    <div
      v-if="entities.length && !filteredEntities.length"
      class="border-border-default text-text-secondary flex shrink-0 items-center gap-2 border-t px-3 py-2 text-xs"
      data-test="edit-role-module-pane-no-match"
    >
      <span>{{
        listsModules ? t("iam.editRole.noModuleMatch") : t("iam.editRole.noMatchingResources")
      }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="edit-role-module-pane-clear-filter"
        @click="clearFilter"
      >
        {{ t("iam.editRole.clearFilter") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

export type ScopeRow = {
  key: string;
  node: any;
  /** Still locks the rows below, but is edited on its own module's page, so it is not drawn here. */
  hidden?: boolean;
  /** The resource type this row's own grant is written against. */
  resource: string;
  /** Resource types whose rows below this scope inherit its grants. */
  covers: string[];
  label: I18nText;
  hint: I18nText;
};

export type PermissionChange = { row: any; permission: string; newValue: boolean };

const props = defineProps<{
  trail: I18nText[];
  scopes: ScopeRow[];
  entities: any[];
  loading: boolean;
  isGranted: (node: any, action: string) => boolean;
  /** False for an org-wide module, whose only row is its own grant, so there is nothing to search. */
  listsResources: boolean;
  /** What is granted one level below a drill-in row, which its own checkboxes cannot show. */
  innerGrants: (node: any, nameLimit: number) => { count: number; names: string[] };
  /** A saved grant the user has staged for removal: still held, but no longer ticked. */
  isPendingRemoval: (node: any, action: string) => boolean;
  added?: number;
  removed?: number;
  icon?: IconName;
  /** Rows are whole modules (All Modules view): each action header gets a select-all box, and every row opens its module. */
  listsModules?: boolean;
}>();

const emit = defineEmits<{
  change: [change: PermissionChange];
  open: [row: any];
  navigate: [index: number];
}>();

const backTarget = computed(() =>
  props.trail.length > 1
    ? {
        label: props.trail[props.trail.length - 2],
        onClick: () => emit("navigate", props.trail.length - 2),
        dataTest: "edit-role-module-pane-back",
      }
    : undefined,
);

const PAGE_SIZE = 25;

const INSIDE_HINT_LIMIT = 10;

const ALLOW_ALL = "AllowAll";

const ACTIONS = [ALLOW_ALL, "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

const { t } = useI18nTyped();

const query = ref("");

const scope = ref("all");

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "label",
    header: props.listsModules
      ? t("iam.editRole.moduleColumn")
      : t("iam.editRole.moduleResourceColumn"),
    accessorKey: "label",
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  { id: "AllowAll", header: actionHeader(t("iam.all")), size: 72, meta: { align: "left" } },
  { id: "AllowList", header: actionHeader(t("iam.list")), size: 72, meta: { align: "left" } },
  { id: "AllowGet", header: actionHeader(t("iam.get")), size: 72, meta: { align: "left" } },
  { id: "AllowPost", header: actionHeader(t("iam.create")), size: 90, meta: { align: "left" } },
  { id: "AllowPut", header: actionHeader(t("iam.update")), size: 90, meta: { align: "left" } },
  { id: "AllowDelete", header: actionHeader(t("iam.delete")), size: 90, meta: { align: "left" } },
]);

// Index is the position in the full scope list, which is the depth inheritance is measured against.
type PaneRow =
  | {
      kind: "scope";
      rowKey: string;
      key: string;
      node: any;
      resource: string;
      depth: number;
      label: I18nText;
      hint: I18nText;
    }
  | { kind: "entity"; rowKey: string; node: any; resource: string; depth: number };

const page = ref(1);

const pageSize = defineModel<number>("pageSize", { default: PAGE_SIZE });

const onPaginationChange = ({ page: next, size }: { page: number; size: number }) => {
  page.value = size === pageSize.value ? next : 1;
  pageSize.value = size;
};

const hasOwnGrant = (row: any) => ACTIONS.some((action) => props.isGranted(row, action));

// Coverage is per resource type, not per row, so it is resolved once instead of 3505 times.
const coveredResources = computed(() => {
  const covered = new Set<string>();
  props.scopes.forEach((wider) => {
    if (ACTIONS.some((action) => props.isGranted(wider.node, action)))
      wider.covers.forEach((resource) => covered.add(resource));
  });
  return covered;
});

// The Selected filter and the count follow the checkboxes: a row locked by a wider scope counts as selected.
const hasEffectiveGrant = (row: any) =>
  hasOwnGrant(row) || coveredResources.value.has(row.resourceName);

// Granted rows lead, but the order is fixed when a list opens: re-sorting on every tick would move the row under the cursor.
const grantedAtOpen = ref(new Set<string>());

watch(
  // Length, since loaders push into the same array; loading, since a list shown mid-load only learns its grants at the end.
  [() => props.entities.length, () => props.loading],
  () => {
    grantedAtOpen.value = new Set(props.entities.filter(hasOwnGrant).map((row) => row.name));
  },
  { immediate: true },
);

const orderedEntities = computed(() => {
  const granted = grantedAtOpen.value;
  if (!granted.size) return props.entities;
  return [
    ...props.entities.filter((row) => granted.has(row.name)),
    ...props.entities.filter((row) => !granted.has(row.name)),
  ];
});

// A new filter narrows the list, so it always starts from the first page.
const setFilter = (nextQuery: string, nextScope: string) => {
  query.value = nextQuery;
  scope.value = nextScope;
  page.value = 1;
};

const filteredEntities = computed(() => {
  const term = query.value.trim().toLowerCase();
  return orderedEntities.value.filter((row) => {
    if (scope.value === "granted" && !hasEffectiveGrant(row) && !insideOf(row).count) return false;
    return (
      !term ||
      String(row.display_name ?? row.name)
        .toLowerCase()
        .includes(term)
    );
  });
});

// Scope rows stay pinned above every page, so the grants that lock resources are never out of sight.
// Unticking the last granted row shrinks the list; an unclamped page would strand the user on an empty one.
const currentPage = computed(() =>
  Math.min(page.value, Math.max(1, Math.ceil(filteredEntities.value.length / pageSize.value))),
);

const tableRows = computed<PaneRow[]>(() => {
  const scopeRows: PaneRow[] = props.scopes
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.hidden)
    .map(({ row, index }) => ({
      kind: "scope" as const,
      rowKey: `scope:${row.key}`,
      key: row.key,
      node: row.node,
      resource: row.resource,
      depth: index,
      label: row.label,
      hint: row.hint,
    }));

  const start = (currentPage.value - 1) * pageSize.value;
  const entityRows: PaneRow[] = filteredEntities.value
    .slice(start, start + pageSize.value)
    .map((node) => ({
      kind: "entity" as const,
      rowKey: `entity:${node.name}`,
      node,
      resource: node.resourceName,
      depth: props.scopes.length,
    }));

  return [...scopeRows, ...entityRows];
});

const checkboxTest = (row: PaneRow, action: string) =>
  row.kind === "scope"
    ? `edit-role-module-pane-scope-${row.key}-${action}`
    : row.kind === "entity"
      ? `edit-role-permissions-table-body-row-${row.node.name}-col-${action}-checkbox`
      : "";

// OTable snapshots `pagination` at mount, so the mode change is keyed to remount the table.
const paginationMode = computed(() =>
  props.listsResources && props.entities.length ? "server" : "none",
);

// Modules without entities (Search Jobs, Settings) have nothing to list, so "no resources yet" would mislead there.
const noResources = computed(
  () => !props.loading && props.listsResources && !props.entities.length,
);

const clearFilter = () => setFilter("", "all");

// Resolved once per change for the whole list; the badge, its tooltip and the Selected filter all read this.
const insideByRow = computed(
  () => new Map(props.entities.map((row) => [row.name, props.innerGrants(row, INSIDE_HINT_LIMIT)])),
);

const insideOf = (row: any) => insideByRow.value.get(row.name) ?? { count: 0, names: [] };

const insideHint = ({ count, names }: { count: number; names: string[] }) =>
  count > names.length
    ? t("iam.editRole.grantedInsideMore", { names: names.join(", "), more: count - names.length })
    : t("iam.editRole.grantedInside", { names: names.join(", ") });

const grantedRowCount = computed(() => props.entities.filter(hasEffectiveGrant).length);

/** A wider scope locks only the resource types it declares it covers, so unverified coverage locks nothing. */
const isInherited = (resource: string, action: string, depth: number) =>
  props.scopes
    .slice(0, depth)
    // model.fga defines every action as `ALLOW_ALL or ALLOW_<ACTION>`, so a wider AllowAll covers each column below.
    .some(
      (wider) =>
        wider.covers.includes(resource) &&
        (props.isGranted(wider.node, action) || props.isGranted(wider.node, ALLOW_ALL)),
    );

// A row with its own grant, or one just revoked, stays editable so the click has somewhere to go back to.
const lockedByWiderScope = (node: any, resource: string, action: string, depth: number) =>
  isInherited(resource, action, depth) &&
  !props.isGranted(node, action) &&
  !props.isPendingRemoval(node, action);

// A revoked own grant must read unchecked, or the click leaves the row looking untouched.
const isChecked = (node: any, resource: string, action: string, depth: number) =>
  props.isGranted(node, action) || lockedByWiderScope(node, resource, action, depth);

const checkboxHint = (node: any, resource: string, action: string, depth: number) => {
  if (!isInherited(resource, action, depth)) return undefined;
  if (props.isPendingRemoval(node, action)) return t("iam.editRole.stillGrantedByWiderScope");
  return props.isGranted(node, action)
    ? t("iam.editRole.grantedHereAndByWiderScope")
    : t("iam.editRole.grantedByWiderScope");
};

const change = (row: any, permission: string, newValue: boolean) =>
  emit("change", { row, permission, newValue });

// Every row the filter keeps, on every page; module rows sit under no wider scope, so none is locked.
const bulkRows = (action: string) =>
  filteredEntities.value.filter((node) => node.permission?.[action]?.show);

const bulkState = (action: string) => {
  const rows = bulkRows(action);
  const checked = rows.filter((node) => props.isGranted(node, action)).length;
  if (!checked) return false;
  return checked === rows.length ? true : "indeterminate";
};

const toggleBulk = (action: string) => {
  const rows = bulkRows(action);
  const newValue = !rows.every((node) => props.isGranted(node, action));
  rows
    .filter((node) => props.isGranted(node, action) !== newValue)
    .forEach((node) => change(node, action, newValue));
};

// A render function, so the box re-reads the grants each time the header draws; the column id is the action.
const actionHeader = (label: I18nText) => {
  if (!props.listsModules) return label;
  const hint = t("iam.editRole.bulkSelectColumn", { action: label });
  // The table truncates header content, which clips anything outside the box; the padding leaves room for the focus ring.
  return ({ column }: { column: { id: string } }) =>
    h("div", { class: "flex items-center gap-1.5 py-1 ps-1" }, [
      h(OCheckbox, {
        modelValue: bulkState(column.id),
        disabled: props.loading || !bulkRows(column.id).length,
        ariaLabel: hint,
        title: hint,
        "data-test": `edit-role-module-pane-bulk-${column.id}`,
        "onUpdate:modelValue": () => toggleBulk(column.id),
      }),
      h("span", label),
    ]);
};
</script>
