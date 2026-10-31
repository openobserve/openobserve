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
  <section class="mb-5" :data-test="`overview-${testSection}-${kind}`">
    <div class="mb-2 flex items-center ps-1">
      <div class="text-text-heading text-sm font-medium">{{ title }}</div>
    </div>
    <div
      class="border-border-default rounded-default bg-surface-base overflow-hidden border border-[0.0625em]"
    >
      <OEmptyState
        size="inline"
        :icon="kind === 'forbidden' ? 'lock' : undefined"
        :title="message"
        :data-test="`overview-${testSection}-${kind}-message`"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  section: "incidents" | "services" | "anomalies" | "recentEvents";
  title: I18nText;
  kind: "empty" | "forbidden";
  noChecks?: boolean;
}>();

const { t } = useI18nTyped();

const message = computed(() => {
  if (props.kind === "forbidden") return t("overview.state.tileForbidden");
  if (props.section === "anomalies" && props.noChecks) return t("overview.empty.anomalyNoChecks");
  return t(`overview.empty.${props.section}`);
});

// data-test ids follow the existing overview-<section>-section ids, which spell recent events with a hyphen
const testSection = computed(() =>
  props.section === "recentEvents" ? "recent-events" : props.section,
);
</script>
