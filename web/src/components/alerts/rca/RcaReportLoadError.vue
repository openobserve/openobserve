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
  <OBanner
    data-test="rca-report-load-failed"
    class="max-w-215"
    variant="error-soft"
    icon="error"
    role="alert"
    inline-actions
  >
    <p class="text-banner-error-soft-text m-0 text-sm font-semibold">
      {{ t("alerts.incidents.rcaRun.reportLoadFailedTitle") }}
    </p>
    <template #actions>
      <OButton
        data-test="rca-report-retry-btn"
        variant="outline"
        size="sm"
        icon-left="refresh"
        @click="emit('retry')"
      >
        {{ t("common.retry") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
</script>
