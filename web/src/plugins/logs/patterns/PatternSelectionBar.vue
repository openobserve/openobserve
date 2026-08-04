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

<!--
  The action bar for building an alert out of a pattern selection. Appears only
  once something is selected, so browsing patterns is unaffected.

  It hosts the shared CreateAlertAction rather than its own button, which is why
  the include/exclude flow inherits the same confirm dialog, warnings, and
  transport as every other surface without restating any of it.
-->

<template>
  <div
    v-if="includedCount + excludedCount > 0"
    class="border-border-default bg-surface-base sticky bottom-0 flex items-center justify-between gap-3 border-t px-3 py-2"
    data-test="pattern-selection-bar"
  >
    <span class="text-text-secondary text-sm" data-test="pattern-selection-summary">
      {{ t("logs.patternList.alertSelectionSummary", { included: includedCount, excluded: excludedCount }) }}
    </span>

    <div class="flex items-center gap-2">
      <OButton
        variant="outline"
        size="sm-action"
        data-test="pattern-selection-clear"
        @click="$emit('clear')"
      >
        {{ t("logs.patternList.clearSelection") }}
      </OButton>

      <CreateAlertAction
        variant="button"
        source="patterns"
        :build="build"
        :disabled-reason="disabledReason"
        data-test="pattern-selection-create-alert"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";

defineProps<{
  includedCount: number;
  excludedCount: number;
  build: () => AlertPrefill;
  disabledReason?: string | null;
}>();

defineEmits<{
  (e: "clear"): void;
}>();

const { t } = useI18n();
</script>
