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
  Data Sources > Recommended > GPU. One setup card per GPU exporter, picked with the
  switch under the card title (as RUM picks its platform). DCGM Exporter is the only
  one today; another vendor is a new EXPORTERS entry plus its registered card.
-->
<template>
  <DataSourceSetupCard :key="exporter" :slug="current.slug">
    <template #hero-under-title>
      <OToggleGroup
        :model-value="exporter"
        type="single"
        :aria-label="t('ingestion.gpuExporter')"
        data-test="gpu-setup-exporter-group"
        @update:model-value="(v: any) => v && (exporter = v as string)"
      >
        <OToggleGroupItem
          v-for="e in EXPORTERS"
          :key="e.id"
          :value="e.id"
          size="sm"
          :data-test="`gpu-setup-exporter-${e.id}`"
        >
          <img :src="e.icon" alt="" class="me-1.5 size-3.5" />
          {{ e.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>
  </DataSourceSetupCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

defineProps<{
  currOrgIdentifier?: string;
  currUserEmail?: string;
}>();

const { t } = useI18nTyped();

/** `slug` resolves the card through setupCard/registry.ts. */
const EXPORTERS: { id: string; slug: string; label: I18nText; icon: string }[] = [
  {
    id: "dcgm",
    slug: "nvidiaDcgm",
    label: raw("DCGM Exporter"),
    icon: getImageURL("images/ingestion/nvidia.svg"),
  },
];

const exporter = ref<string>(EXPORTERS[0].id);
const current = computed(() => EXPORTERS.find((e) => e.id === exporter.value) ?? EXPORTERS[0]);
</script>
