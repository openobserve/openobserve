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
  <div
    class="flex flex-wrap items-center gap-4"
    data-test="rum-errors-filter-bar"
  >
    <OToggleGroup
      :model-value="status"
      type="single"
      :label="t('rum.statusColumn')"
      label-position="left"
      @update:model-value="(v: any) => v && emit('update:status', v)"
    >
      <OToggleGroupItem
        value="all"
        size="xs"
        data-test="rum-errors-filter-status-all"
        >{{ t("rum.all") }}</OToggleGroupItem
      >
      <OToggleGroupItem
        value="new"
        size="xs"
        data-test="rum-errors-filter-status-new"
        >{{ t("rum.statusNew") }} · {{ counts.new }}</OToggleGroupItem
      >
      <OToggleGroupItem
        value="ongoing"
        size="xs"
        data-test="rum-errors-filter-status-ongoing"
        >{{ t("rum.statusOngoing") }} · {{ counts.ongoing }}</OToggleGroupItem
      >
    </OToggleGroup>

    <OToggleGroup
      :model-value="type"
      type="single"
      :label="t('rum.type')"
      label-position="left"
      @update:model-value="(v: any) => v && emit('update:type', v)"
    >
      <OToggleGroupItem
        value="all"
        size="xs"
        data-test="rum-errors-filter-type-all"
        >{{ t("rum.all") }}</OToggleGroupItem
      >
      <OToggleGroupItem
        value="unhandled"
        size="xs"
        data-test="rum-errors-filter-type-unhandled"
        >{{ t("rum.unhandled") }} · {{ counts.unhandled }}</OToggleGroupItem
      >
      <OToggleGroupItem
        value="handled"
        size="xs"
        data-test="rum-errors-filter-type-handled"
        >{{ t("rum.handled") }} · {{ counts.handled }}</OToggleGroupItem
      >
    </OToggleGroup>

    <div class="flex items-center gap-1.5 ml-auto">
      <label for="rum-errors-filter-service" class="whitespace-nowrap">{{
        t("rum.service")
      }}</label>
      <OSelect
        id="rum-errors-filter-service"
        :model-value="service || ALL_SERVICES"
        :options="serviceOptions"
        size="sm"
        class="min-w-[9rem]"
        data-test="rum-errors-filter-service-select"
        @update:model-value="onServiceSelect"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export type IssueStatusFilter = "all" | "new" | "ongoing";
export type IssueTypeFilter = "all" | "unhandled" | "handled";

const props = defineProps<{
  status: IssueStatusFilter;
  type: IssueTypeFilter;
  /** "" = all services. */
  service: string;
  /** Distinct service names from the current result set. */
  services: string[];
  counts: {
    new: number;
    ongoing: number;
    unhandled: number;
    handled: number;
  };
}>();

const emit = defineEmits<{
  "update:status": [value: IssueStatusFilter];
  "update:type": [value: IssueTypeFilter];
  "update:service": [value: string];
}>();

const { t } = useI18n();

// OSelect treats "" as "no selection" (placeholder), so the All option
// needs a real sentinel value; the emitted contract stays "" = all.
// Underscored to avoid colliding with a service actually named "all".
const ALL_SERVICES = "__all__";

const serviceOptions = computed(() => [
  { label: t("rum.all"), value: ALL_SERVICES },
  ...props.services.map((service) => ({ label: service, value: service })),
]);

const onServiceSelect = (value: unknown) => {
  const selected = String(value ?? ALL_SERVICES);
  emit("update:service", selected === ALL_SERVICES ? "" : selected);
};
</script>
