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
  VersionCompareBar — the two version pickers (A/B) only. The alignment toggle +
  manual date windows live with the trend chart (they reshape its x-axis), and
  Exit lives in the scope row next to the Compare entry — see VersionCompareView.
  Purely presentational — the parent owns the selected A/B versions.

  The UNSET sentinel ("__unset__") is filtered out of both slots' option lists
  — comparing "no version" against a real version is meaningless. When A and B
  resolve to the same version, an inline hint nudges the user to pick two
  different ones (the parent still renders whatever comparison it can, this is
  a hint not a hard block).
-->
<template>
  <!-- The compare bar holds ONLY the two version pickers (the "what am I
       comparing" selection). The alignment toggle + manual date windows live with
       the trend chart (they reshape the chart's x-axis), and Exit lives up in the
       scope row next to where Compare was entered — mirroring how Datadog/Grafana/
       Sentry keep entity-selection separate from the overlay/align control. -->
  <div class="px-page-edge border-border-default border-b py-2">
    <div class="flex items-center gap-3">
      <div class="w-64 flex-shrink-0">
        <OSelect
          :model-value="a"
          :label="t('aiObservability.versionCompare.bar.versionA')"
          label-position="inside"
          :options="optionsWithoutUnset"
          labelKey="label"
          valueKey="value"
          class="rounded-default w-full"
          data-test="version-compare-bar-a"
          @update:model-value="(v: unknown) => emit('update:a', v as string)"
        />
      </div>

      <div class="w-64 flex-shrink-0">
        <OSelect
          :model-value="b"
          :label="t('aiObservability.versionCompare.bar.versionB')"
          label-position="inside"
          :options="optionsWithoutUnset"
          labelKey="label"
          valueKey="value"
          class="rounded-default w-full"
          data-test="version-compare-bar-b"
          @update:model-value="(v: unknown) => emit('update:b', v as string)"
        />
      </div>

      <span
        v-if="sameVersion"
        data-test="version-compare-bar-same-hint"
        class="text-text-secondary text-xs"
      >
        {{ t("aiObservability.versionCompare.bar.samePickHint") }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";

// Mirrors useAgentScope's UNSET sentinel — kept as a local literal to avoid a
// cross-composable import for a single constant.
const UNSET = "__unset__";

const props = defineProps<{
  /** Full version option list — UNSET is filtered before rendering. */
  versions: SelectOption[];
  /** Selected version for arm A (two-way via update:a). */
  a: string;
  /** Selected version for arm B (two-way via update:b). */
  b: string;
}>();

const emit = defineEmits<{
  (e: "update:a", value: string): void;
  (e: "update:b", value: string): void;
}>();

const { t } = useI18nTyped();

const optionsWithoutUnset = computed(() => props.versions.filter((o) => o.value !== UNSET));

const sameVersion = computed(() => !!props.a && !!props.b && props.a === props.b);
</script>
