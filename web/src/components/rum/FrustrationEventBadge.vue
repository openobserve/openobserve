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
  <span class="inline-flex items-center gap-1" data-test="frustration-event-badge-wrapper">
    <OTag
      v-for="(type, index) in frustrationTypes"
      :key="index"
      type="frustrationEventType"
      :value="type"
      :data-test="`frustration-event-badge-${type}`"
      :title="getTooltipText(type)"
    />
  </span>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped } from "@/types/i18n";

interface Props {
  frustrationTypes: string[];
}

defineProps<Props>();

const { t } = useI18nTyped();

const tooltips: Record<string, string> = {
  rage_click: t("rum.frustrationRageClick"),
  dead_click: t("rum.frustrationDeadClick"),
  error_click: t("rum.frustrationErrorClick"),
  rage_tap: t("rum.frustrationRageTap"),
  error_tap: t("rum.frustrationErrorTap"),
};

const getTooltipText = (type: string) => tooltips[type] || t("rum.frustrationSignalType", { type });
</script>
