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
  <div class="flex flex-col gap-2" data-test="downtime-resource-picker">
    <div class="flex flex-wrap items-end gap-2">
      <span class="text-text-label pb-2 text-xs font-medium">
        {{ t("alerts.downtimes.resources.refineBy") }}
      </span>
      <OSelect
        :model-value="refineBy"
        class="w-44"
        size="sm"
        :options="dimensionOptions"
        searchable
        data-test="downtime-resource-picker-dimension"
        @update:model-value="pickDimension"
      />
      <OButton
        variant="outline"
        size="sm"
        :loading="loading"
        :disabled="!canLoad"
        data-test="downtime-resource-picker-load"
        @click="load"
      >
        {{ t("alerts.downtimes.resources.load") }}
      </OButton>
      <span v-if="!canLoad" class="text-text-secondary pb-2 text-xs">
        {{ t("alerts.downtimes.resources.needsEq") }}
      </span>
    </div>

    <OBanner
      v-if="response && response.total > MAX_VALUES"
      variant="warning"
      dense
      :content="t('alerts.downtimes.resources.tooMany', { count: response.total })"
      data-test="downtime-resource-picker-too-many"
    />

    <p
      v-else-if="canLoad && !response && suggestionsSettled && rows.length === 0"
      class="text-text-secondary text-xs"
      data-test="downtime-resource-picker-empty"
    >
      {{ t("alerts.downtimes.resources.noValues") }}
    </p>

    <div
      v-else-if="canLoad && rows.length > 0"
      class="border-border-default rounded-surface flex flex-col overflow-hidden border"
    >
      <OTable
        v-model:selected-ids="selected"
        :data="rows"
        :columns="columns"
        row-key="value"
        selection="multiple"
        pagination="none"
        :fill-height="false"
        :show-global-filter="false"
        max-height="18rem"
        data-test="downtime-resource-picker-table"
      >
        <template #cell-last_seen="{ row }">
          <OTimeCell v-if="row.last_seen" :value="row.last_seen" unit="us" />
        </template>
        <template #cell-streams="{ row }">
          <div class="flex flex-wrap gap-1">
            <OTag
              v-for="stream in row.streams ?? []"
              :key="stream"
              type="exampleChip"
              value="dim"
              :label="raw(stream)"
            />
          </div>
        </template>
      </OTable>
      <div class="border-border-default flex items-center justify-between gap-2 border-t px-3 py-2">
        <span class="text-text-secondary text-xs" data-test="downtime-resource-picker-footer">
          {{ footer }}
        </span>
        <div class="flex gap-2">
          <OButton
            v-if="response"
            variant="outline"
            size="sm-action"
            data-test="downtime-resource-picker-cancel"
            @click="close"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="selected.length === 0"
            data-test="downtime-resource-picker-apply"
            @click="apply"
          >
            {{ t("alerts.downtimes.resources.apply") }}
          </OButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { queryClient } from "@/composables/query/queryClient";
import { dimensionAnalyticsQuery, semanticGroupsQuery } from "@/services/service_streams.queries";
import { downtimeResourcesQuery, downtimeValuesQuery } from "@/services/downtimes.queries";
import type { DimensionCondition, ResourcesResponse } from "@/services/downtimes";
import { andEqPairs } from "@/utils/downtimes/conditionBridge";
import { useToast } from "@/lib/feedback/Toast/useToast";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

const MAX_VALUES = 500;
const DEFAULT_DIMENSION = "host";

/** One pickable value: a suggestion carries `items`, a loaded resource carries `streams`. */
interface PickerRow {
  value: string;
  items?: number;
  last_seen?: number;
  streams?: string[];
}

const props = defineProps<{
  condition: DimensionCondition | null;
  /** The downtime's own folder, which the route permission check reads. */
  folder?: string;
}>();

const emit = defineEmits<{
  apply: [key: string, values: string[]];
}>();

const { t } = useI18nTyped();
const { toast } = useToast();
const orgId = useOrgId();

const semanticGroups = useQuery(() =>
  Object.assign(semanticGroupsQuery(orgId.value), { enabled: !!orgId.value }),
);

const dimensionOptions = computed<SelectOption[]>(() =>
  (semanticGroups.data.value ?? []).map((g) => ({ label: raw(g.display || g.id), value: g.id })),
);

const hasHost = computed(() => dimensionOptions.value.some((o) => o.value === DEFAULT_DIMENSION));

// The registry's ranking is only needed when the org has no `host` group.
const analytics = useQuery(() =>
  Object.assign(dimensionAnalyticsQuery(orgId.value), {
    enabled: !!orgId.value && !!semanticGroups.data.value && !hasHost.value,
  }),
);

const defaultDimension = computed(() => {
  const known = new Set(dimensionOptions.value.map((o) => String(o.value)));
  if (known.has(DEFAULT_DIMENSION)) return DEFAULT_DIMENSION;
  const priority = analytics.data.value?.recommended_priority_dimensions ?? [];
  return priority.find((d) => known.has(d)) ?? String(dimensionOptions.value[0]?.value ?? "");
});

const refineBy = ref<string>("");
const userPicked = ref(false);
watch(
  defaultDimension,
  (next) => {
    if (!userPicked.value) refineBy.value = next;
  },
  { immediate: true },
);

const pickDimension = (value: unknown) => {
  userPicked.value = true;
  refineBy.value = String(value ?? "");
  close();
};

const pairs = computed(() => andEqPairs(props.condition).filter((p) => p.value !== ""));
const canLoad = computed(() => !!refineBy.value && pairs.value.length > 0);

const suggestions = useQuery(() =>
  Object.assign(
    downtimeValuesQuery(
      orgId.value,
      refineBy.value,
      "",
      pairs.value.filter((p) => p.key !== refineBy.value),
      props.folder,
    ),
    { enabled: !!orgId.value && canLoad.value },
  ),
);
const suggestionsSettled = computed(
  () => suggestions.isSuccess.value && !suggestions.isFetching.value,
);
// Kept-previous rows belong to the last dimension or condition, so they are never pickable.
const suggestionRows = computed(() =>
  suggestions.isPlaceholderData.value ? [] : (suggestions.data.value?.values ?? []),
);

const loading = ref(false);
const response = ref<ResourcesResponse | null>(null);
const selected = ref<string[]>([]);

const rows = computed<PickerRow[]>(() => response.value?.values ?? suggestionRows.value);

// A selection names values of one dimension under one condition; a new context drops it.
watch(
  () => JSON.stringify([refineBy.value, pairs.value]),
  () => close(),
);

const footer = computed(() => {
  if (response.value) {
    return t("alerts.downtimes.resources.footer", {
      selected: selected.value.length,
      total: response.value.total,
      source:
        response.value.source === "registry"
          ? t("alerts.downtimes.resources.fromRegistry")
          : t("alerts.downtimes.resources.fromSearch"),
    });
  }
  const footerText = t("alerts.downtimes.resources.footer", {
    selected: selected.value.length,
    total: rows.value.length,
    source: t("alerts.downtimes.resources.fromValues"),
  });
  return suggestions.data.value?.partial
    ? raw(`${footerText} ${t("alerts.downtimes.resources.partial")}`)
    : footerText;
});

const columns = computed<OTableColumnDef<PickerRow>[]>(() => [
  { id: "value", accessorKey: "value", header: raw(refineBy.value), size: 160 },
  response.value
    ? { id: "streams", header: t("alerts.downtimes.resources.streams"), cell: " ", size: 240 }
    : {
        id: "items",
        accessorKey: "items",
        header: t("alerts.downtimes.resources.items"),
        size: 80,
      },
  {
    id: "last_seen",
    accessorKey: "last_seen",
    header: t("alerts.downtimes.resources.lastSeen"),
    cell: " ",
    size: 130,
  },
]);

const load = async () => {
  if (!props.condition || !canLoad.value) return;
  loading.value = true;
  try {
    const options = downtimeResourcesQuery(
      orgId.value,
      { condition: props.condition, refine_by: refineBy.value },
      props.folder,
    );
    // A user-initiated load always reaches the server.
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
    response.value = await queryClient.fetchQuery(options);
    selected.value = [];
  } catch {
    toast({ variant: "error", message: t("alerts.downtimes.resources.loadFailed") });
  } finally {
    loading.value = false;
  }
};

const close = () => {
  response.value = null;
  selected.value = [];
};

const apply = () => {
  emit("apply", refineBy.value, [...selected.value]);
  close();
};
</script>
