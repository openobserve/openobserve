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
        v-model="refineBy"
        class="w-44"
        size="sm"
        :options="dimensionOptions"
        :searchable="false"
        data-test="downtime-resource-picker-dimension"
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

    <div
      v-else-if="response"
      class="border-border-default rounded-surface flex flex-col overflow-hidden border"
    >
      <OTable
        v-model:selected-ids="selected"
        :data="response.values"
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
          <OTimeCell :value="row.last_seen" unit="us" />
        </template>
        <template #cell-streams="{ row }">
          <div class="flex flex-wrap gap-1">
            <OTag
              v-for="stream in row.streams"
              :key="stream"
              type="exampleChip"
              value="dim"
              :label="raw(stream)"
            />
          </div>
        </template>
      </OTable>
      <div
        class="border-border-default flex items-center justify-between gap-2 border-t px-3 py-2"
      >
        <span class="text-text-secondary text-xs" data-test="downtime-resource-picker-footer">
          {{
            t("alerts.downtimes.resources.footer", {
              selected: selected.length,
              total: response.total,
              source:
                response.source === "registry"
                  ? t("alerts.downtimes.resources.fromRegistry")
                  : t("alerts.downtimes.resources.fromSearch"),
            })
          }}
        </span>
        <div class="flex gap-2">
          <OButton
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
import { identityConfigQuery } from "@/services/service_streams.queries";
import { downtimeResourcesQuery } from "@/services/downtimes.queries";
import type { DimensionCondition, ResourcesResponse, ResourceValue } from "@/services/downtimes";
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
const FALLBACK_DIMENSIONS = ["host", "pod", "instance", "k8s-node-name"];

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

const identityConfig = useQuery(() =>
  Object.assign(identityConfigQuery(orgId.value), { enabled: !!orgId.value }),
);

const dimensions = computed(() => {
  const fromSets = (identityConfig.data.value?.sets ?? []).flatMap((s) => s.distinguish_by);
  return [...new Set(fromSets.length ? fromSets : FALLBACK_DIMENSIONS)];
});

const dimensionOptions = computed<SelectOption[]>(() =>
  dimensions.value.map((d) => ({ label: raw(d), value: d })),
);

const refineBy = ref<string>("");
watch(
  dimensions,
  (list) => {
    if (!list.includes(refineBy.value)) refineBy.value = list[0] ?? "";
  },
  { immediate: true },
);

const canLoad = computed(() => !!refineBy.value && andEqPairs(props.condition).length > 0);

const loading = ref(false);
const response = ref<ResourcesResponse | null>(null);
const selected = ref<string[]>([]);

const columns = computed<OTableColumnDef<ResourceValue>[]>(() => [
  { id: "value", accessorKey: "value", header: refineBy.value, size: 160 },
  {
    id: "last_seen",
    accessorKey: "last_seen",
    header: t("alerts.downtimes.resources.lastSeen"),
    cell: " ",
    size: 130,
  },
  { id: "streams", header: t("alerts.downtimes.resources.streams"), cell: " ", size: 240 },
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
