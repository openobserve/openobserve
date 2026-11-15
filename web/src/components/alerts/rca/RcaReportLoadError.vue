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
  <OEmptyState
    kind="error"
    role="alert"
    :title="t('alerts.incidents.rcaRun.reportLoadFailedTitle')"
    data-test="rca-report-load-failed"
  >
    <template #actions>
      <OButton data-test="rca-report-retry-btn" variant="secondary" @click="emit('retry')">
        {{ t("common.retry") }}
      </OButton>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped } from "@/types/i18n";

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
</script>
