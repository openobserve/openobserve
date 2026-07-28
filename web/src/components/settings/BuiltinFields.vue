<!--
  Copyright 2026 OpenObserve Inc.

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
  <!-- The standard-tier attribute is ALWAYS checked FIRST — before the editable
       fallbacks in the textarea above — and cannot be removed. Shown read-only so
       users see the full detection order: this standard attribute, then their
       (seeded, editable) fallbacks. -->
  <div class="flex flex-wrap items-center gap-1.5 text-xs">
    <span class="text-text-secondary">{{
      t("settings.genAiAgentMapping.alwaysAppliedStandard")
    }}</span>
    <OBadge v-for="f in standard" :key="f" variant="primary-soft" size="sm">{{ f }}</OBadge>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";

defineProps<{
  /** Standard-tier attribute(s) tried FIRST (current OTel/GenAI semconv). */
  standard: readonly string[];
}>();

const { t } = useI18nTyped();
</script>
