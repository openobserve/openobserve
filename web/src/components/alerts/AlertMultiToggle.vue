<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Simple vs Multi alert choice (alerts_2.md M-9 / §5.4).

  Rendered only when the alert has at least one Group By column — multi is a
  deliberate monitor choice, never inferred from `by {host}` being present.
  Turning it on for an existing grouped alert would silently change its paging
  cadence and reset its silence fingerprints, which is exactly what the opt-in
  exists to prevent.

  The switch is bound by `name=` only; the parent normalises the group-count
  gate when it flips, because M-10 rejects any count rule other than
  "at least 1 group" alongside per-group evaluation.
-->
<template>
  <div
    class="rounded-default text-compact flex items-start gap-3 px-3 py-2"
    data-test="alerts-alertmultitoggle-row"
  >
    <span
      class="text-text-heading text-compact min-w-22.5 shrink-0 leading-8.5 font-bold whitespace-nowrap"
    >
      {{ t("alerts.multiAlert.label") }}
      <OTooltip :content="t(onDescriptionKey)" :delay="300" side="top" />
    </span>
    <div class="flex flex-col gap-1">
      <!-- An explicit two-option choice, not a switch (§5.4 calls it a
           "Simple vs Multi alert choice"). A switch was tried and read as
           already-enabled: OSwitch's OFF state is a primary-coloured outline
           with a primary thumb, so the only thing distinguishing off from on
           was the label beside it. For a control that changes how many alerts
           this monitor becomes, both options have to be visible at once. -->
      <div class="flex h-8.5 items-center">
        <OFormOptionGroup
          :name="name"
          type="radio"
          orientation="horizontal"
          size="sm"
          :options="options"
          data-test="alerts-alertmultitoggle-choice"
          @update:model-value="emit('change', $event)"
        />
      </div>
      <p class="text-xs text-text-secondary">
        {{ enabled ? t(onDescriptionKey) : t("alerts.multiAlert.simpleDescription") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(
  defineProps<{
    enabled: boolean;
    /**
     * Field this choice writes. Defaults to the aggregation flag; a PromQL
     * alert passes `query_condition.promql_multi_alert`, because it has no
     * aggregation for the flag to live inside.
     */
    name?: string;
    /**
     * What one unit of fan-out IS for this alert. `group` = one row of a
     * GROUP BY; `series` = one PromQL series. The distinction is not cosmetic:
     * telling a PromQL user their alert splits "per group" invites them to
     * look for a Group By field that this tab does not have.
     */
    unit?: "group" | "series";
  }>(),
  {
    name: "query_condition.aggregation.multi_alert",
    unit: "group",
  },
);

const emit = defineEmits<{ change: [value: unknown] }>();

const { t } = useI18n();

const onLabelKey = computed(() =>
  props.unit === "series" ? "alerts.multiAlert.perSeries" : "alerts.multiAlert.perGroup",
);
const onDescriptionKey = computed(() =>
  props.unit === "series"
    ? "alerts.multiAlert.perSeriesDescription"
    : "alerts.multiAlert.perGroupDescription",
);

// Boolean option values, so the field still stores the same boolean the API
// expects — the control changed, the payload did not.
const options = computed(() => [
  { label: t("alerts.multiAlert.simple"), value: false },
  { label: t(onLabelKey.value), value: true },
]);
</script>
