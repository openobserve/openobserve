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
  VersionCompareBar — the compare-mode control bar: two version pickers (A/B),
  an Align toggle (Since each rollout / Same wall-clock / Manual), and an exit
  button. Purely presentational — the parent owns the selected A/B versions and
  align mode and re-derives windows/results when they change.

  The UNSET sentinel ("__unset__") is filtered out of both slots' option lists
  — comparing "no version" against a real version is meaningless. When A and B
  resolve to the same version, an inline hint nudges the user to pick two
  different ones (the parent still renders whatever comparison it can, this is
  a hint not a hard block).
-->
<template>
  <!-- Two-row grid so every control shares one baseline. Row 1 holds the version
       pickers + the Align toggle + exit (all on the same line). Row 2 holds each
       arm's window slot directly under its picker. Fixed row-1 height means the
       Align bar never looks offset from the pickers, and the window row keeps a
       constant height whether it shows an "auto:" caption or a date picker (no
       layout shift when toggling Manual mode). -->
  <div class="px-page-edge py-2 border-b border-border-default">
    <div class="flex items-center gap-3">
      <div class="w-64 flex-shrink-0">
        <OSelect
          :model-value="a"
          :label="t('aiObservability.versionCompare.bar.versionA')"
          label-position="inside"
          :options="optionsWithoutUnset"
          labelKey="label"
          valueKey="value"
          class="w-full rounded-default"
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
          class="w-full rounded-default"
          data-test="version-compare-bar-b"
          @update:model-value="(v: unknown) => emit('update:b', v as string)"
        />
      </div>

      <OToggleGroup
        :model-value="align"
        type="single"
        data-test="version-compare-bar-align"
        :label="t('aiObservability.versionCompare.bar.align')"
        @update:model-value="(v: unknown) => emit('update:align', v as AlignMode)"
      >
        <OToggleGroupItem value="sinceRollout" size="sm">
          {{ t("aiObservability.versionCompare.bar.alignSinceRollout") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="sameWallClock" size="sm">
          {{ t("aiObservability.versionCompare.bar.alignSameWallClock") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="manual" size="sm">
          {{ t("aiObservability.versionCompare.bar.alignManual") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <!-- Labeled (not a bare X): "Exit compare" makes it obvious this leaves
           comparison mode and returns to the single-version view. -->
      <OButton
        variant="outline"
        size="sm"
        icon-left="close"
        data-test="version-compare-bar-exit"
        @click="emit('exit')"
      >
        {{ t("aiObservability.versionCompare.bar.exit") }}
      </OButton>
    </div>

    <!-- Window row: each date-picker slot is the SAME w-64 as its version picker
         column above. overflow-hidden caps the DateTime trigger (which is content-
         width / w-fit internally and can't be shrunk via props) to exactly the
         column width, so the pickers line up flush under the version dropdowns. -->
    <div v-if="$slots['window-a'] || $slots['window-b']" class="mt-1 flex items-start gap-3">
      <div class="w-64 flex-shrink-0 overflow-hidden"><slot name="window-a" /></div>
      <div class="w-64 flex-shrink-0 overflow-hidden"><slot name="window-b" /></div>
    </div>

    <span
      v-if="sameVersion"
      data-test="version-compare-bar-same-hint"
      class="mt-1 block text-xs text-text-secondary"
    >
      {{ t("aiObservability.versionCompare.bar.samePickHint") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlignMode } from "@/plugins/traces/versionCompare/windows";

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
  /** Current window-alignment mode (two-way via update:align). */
  align: AlignMode;
}>();

const emit = defineEmits<{
  (e: "update:a", value: string): void;
  (e: "update:b", value: string): void;
  (e: "update:align", value: AlignMode): void;
  (e: "exit"): void;
}>();

const { t } = useI18n();

const optionsWithoutUnset = computed(() => props.versions.filter((o) => o.value !== UNSET));

const sameVersion = computed(() => !!props.a && !!props.b && props.a === props.b);
</script>
