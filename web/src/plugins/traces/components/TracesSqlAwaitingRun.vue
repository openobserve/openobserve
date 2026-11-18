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
  <div class="bg-card-glass-bg flex h-full flex-col" data-test="traces-sql-awaiting-run">
    <OEmptyState
      class="min-h-0 flex-1"
      illustration="query"
      variant="neutral"
      size="hero"
      :title="t('traces.sqlMode.awaitingRun.spansTitle')"
      :description="t('traces.sqlMode.awaitingRun.description')"
      :action-label="t('emptyState.noQueryApplied.action')"
      action-icon="play-arrow"
      @action="emit('run')"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

const emit = defineEmits<{
  (e: "run"): void;
}>();

const { t } = useI18nTyped();
</script>
