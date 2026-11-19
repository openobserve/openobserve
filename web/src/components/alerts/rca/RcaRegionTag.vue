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

<!-- Where one run was analyzed, from that run's own record; it never reads the viewer's region. -->
<template>
  <OSkeleton
    v-if="loading"
    v-bind="$attrs"
    :data-test="`${dataTest}-loading`"
    class="h-5 w-36 shrink-0 rounded-full"
  />
  <OTooltip
    v-else-if="known"
    :content="t('alerts.incidents.rcaRun.region.tooltip', { region: regionText })"
  >
    <OTag
      v-bind="$attrs"
      type="fieldTag"
      value="outlinesm"
      icon=""
      class="shrink-0"
      :data-test="dataTest"
      data-region-state="known"
    >
      <template #icon><OIcon name="public" size="xs" /></template>
      {{ label }}
    </OTag>
  </OTooltip>
  <OTag
    v-else
    v-bind="$attrs"
    type="fieldTag"
    value="softsm"
    icon=""
    class="shrink-0"
    :data-test="dataTest"
    :data-region-state="state === 'none' ? 'none' : 'unknown'"
  >
    {{ label }}
  </OTag>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";

// The tooltip wrapper keeps no attributes, so the caller's class lands on the tag itself.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** `context_used.serving_region` of the run; empty or absent reads as unknown. */
    region?: string | null;
    /** `live`: the run is analyzing now; `none`: the incident has no region-local run. */
    state: "live" | "terminal" | "none";
    dataTest?: string;
    /** The run list is still loading: a skeleton holds the slot. */
    loading?: boolean;
  }>(),
  { region: null, dataTest: "rca-analysis-region", loading: false },
);

const { t } = useI18nTyped();

const known = computed(() => props.state !== "none" && !!props.region?.trim());
// An identifier, never translated.
const regionText = computed(() => raw(props.region?.trim()));

const label = computed(() => {
  if (props.state === "none") return t("alerts.incidents.rcaRun.region.noLocalRun");
  if (!known.value) return t("alerts.incidents.rcaRun.region.unknown");
  const region = regionText.value;
  return props.state === "live"
    ? t("alerts.incidents.rcaRun.region.analyzingIn", { region })
    : t("alerts.incidents.rcaRun.region.analyzedIn", { region });
});
</script>
