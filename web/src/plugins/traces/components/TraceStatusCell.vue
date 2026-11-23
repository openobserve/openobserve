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
  <OTag
    v-if="hasErrors"
    data-test="trace-row-status-pill"
    type="spanStatus"
    value="error"
    :label="label"
  />
  <span
    v-else
    data-test="trace-row-status-pill"
    class="text-text-body text-compact inline-flex items-center gap-1.5 font-medium"
  >
    <span aria-hidden="true" class="bg-status-positive size-2 rounded-full"></span>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";

const { t } = useI18nTyped();

const props = defineProps<{
  item: Record<string, any>;
}>();

const hasErrors = computed(() => (props.item.errors ?? 0) > 0);

// A vue-i18n plural message, not `count + (count === 1 ? singular : plural)`:
// the count's position in the phrase and which forms exist are the translator's
// to decide (many languages have more than two).
const label = computed(() =>
  hasErrors.value
    ? t("traces.errorCount", { n: props.item.errors }, props.item.errors)
    : t("traces.success"),
);
</script>
