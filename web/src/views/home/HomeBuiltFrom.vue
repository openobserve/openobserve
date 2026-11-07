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
    v-if="sources.length || moreDegraded > 0"
    class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 ps-1"
    data-test="home-now-built-from"
  >
    <OText variant="meta" class="me-1">{{ t("overview.now.builtFrom") }}</OText>
    <OButton
      v-for="source in sources"
      :key="source"
      variant="ghost-primary"
      size="chip"
      :aria-label="t(`overview.now.viewAll.${source}`)"
      :data-test="`home-now-view-all-${source}`"
      @click="emit('open', source)"
    >
      {{ t(LABEL[source]) }}
    </OButton>
    <OButton
      v-if="moreDegraded > 0"
      variant="ghost-primary"
      size="chip"
      data-test="home-now-more-degraded"
      @click="emit('open', 'services')"
    >
      {{ t("overview.now.moreDegraded", { n: moreDegraded }) }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

export type BuiltFromSource = "incidents" | "services" | "anomalies" | "events";

withDefaults(defineProps<{ sources: BuiltFromSource[]; moreDegraded?: number }>(), {
  moreDegraded: 0,
});

const emit = defineEmits<{ open: [source: BuiltFromSource] }>();

const { t } = useI18nTyped();

const LABEL: Record<BuiltFromSource, I18nKey> = {
  incidents: "menu.incidents",
  services: "overview.services",
  anomalies: "overview.activeAnomalies",
  events: "overview.recentEvents",
};
</script>
