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
    data-test="trace-row-status-pill"
    type="spanStatus"
    :value="hasErrors ? 'error' : 'success'"
    :label="label"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";

const { t } = useI18n();

const props = defineProps<{
  item: Record<string, any>;
}>();

const hasErrors = computed(() => (props.item.errors ?? 0) > 0);

const label = computed(() =>
  hasErrors.value
    ? `${props.item.errors} ${props.item.errors !== 1 ? t("traces.errors") : t("traces.error")}`
    : t("traces.success"),
);
</script>

