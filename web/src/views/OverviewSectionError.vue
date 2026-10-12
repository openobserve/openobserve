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
  <section class="mb-5" :data-test="`overview-${testSection}-load-error`">
    <div class="mb-2 flex items-center ps-1">
      <div class="text-text-heading text-sm font-medium tracking-[0.01em]">{{ title }}</div>
    </div>
    <div
      class="border-border-default rounded-default bg-surface-base overflow-hidden border border-[0.0625em]"
    >
      <OEmptyState size="inline" preset="load-error">
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            :data-test="`overview-${testSection}-load-error-retry-btn`"
            @click="emit('retry')"
          >
            {{ t("emptyState.loadError.action") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  section: "incidents" | "services" | "anomalies" | "recentEvents";
  title: I18nText;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const { t } = useI18nTyped();

// data-test ids follow the existing overview-<section>-section ids, which spell recent events with a hyphen
const testSection = computed(() =>
  props.section === "recentEvents" ? "recent-events" : props.section,
);
</script>
