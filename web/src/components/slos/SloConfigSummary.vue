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
  Read-only configuration summary on the SLO status page — the same card/grid
  surface as AlertConfigSummary, so a user moving between an alert and the SLO
  it watches reads the same layout twice rather than two dialects.

  Deliberately a summary, not an editor: the Edit action in the page header
  owns every change.
-->
<template>
  <div class="flex flex-col gap-4" data-test="slos-sloconfigsummary">
    <OCard v-for="section in sections" :key="section.key">
      <OCardSection role="body">
        <h3 class="text-text-heading mb-3 text-lg">{{ section.title }}</h3>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div
            v-for="field in section.fields"
            :key="field.key"
            class="flex flex-col gap-1"
            :data-test="`slos-sloconfigsummary-${field.key}`"
          >
            <dt class="text-text-secondary text-xs">{{ field.label }}</dt>
            <dd class="text-text-heading text-sm" :class="field.mono ? 'font-mono break-all' : ''">
              {{ field.value }}
            </dd>
          </div>
        </dl>
      </OCardSection>
    </OCard>

    <OCard>
      <OCardSection role="body">
        <h3 class="text-text-heading mb-3 text-lg">{{ t("slos.section.definition") }}</h3>
        <OCodeBlock
          :code="configJson"
          lang="json"
          wrap
          :max-lines="20"
          data-test="slos-sloconfigsummary-json"
        />
        <!-- `{}` on its own is indistinguishable from a rendering fault, so the
             empty case says which one it is rather than leaving two braces. -->
        <p v-if="!hasConfigJson" class="text-text-secondary mt-2 text-xs">
          {{ t("slos.section.definitionEmpty") }}
        </p>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { Slo } from "@/ts/interfaces/slo";
import {
  ABSENT,
  formatSlice,
  formatTarget,
  formatWindow,
  sliTypeLabel,
} from "@/composables/useSloFormat";

const props = defineProps<{ slo: Slo }>();

const { t } = useI18nTyped();

interface SummaryField {
  key: string;
  label: I18nText;
  value: I18nText;
  /** Identifiers and expressions, which are read character by character. */
  mono?: boolean;
}

const isGrouped = computed(() => !!props.slo.group_by?.length);

const sections = computed<{ key: string; title: I18nText; fields: SummaryField[] }[]>(() => [
  {
    key: "configuration",
    title: t("slos.tab.configuration"),
    fields: [
      {
        key: "sli-type",
        label: t("slos.field.sliType"),
        value: raw(sliTypeLabel(props.slo.sli_type, t)),
      },
      {
        key: "target",
        label: t("slos.field.target"),
        value: raw(formatTarget(props.slo.target)),
      },
      {
        key: "window",
        label: t("slos.field.window"),
        value: raw(formatWindow(props.slo.window_secs)),
      },
      {
        key: "slice-interval",
        label: t("slos.field.sliceInterval"),
        value: raw(formatSlice(props.slo.slice_interval_secs)),
      },
      {
        key: "group-by",
        label: t("slos.field.groupBy"),
        value: isGrouped.value ? raw(props.slo.group_by?.join(", ")) : t("slos.noGrouping"),
        mono: isGrouped.value,
      },
      {
        key: "reservation",
        label: t("slos.field.reservation"),
        value: t("slos.reservationValue", { groups: props.slo.groups_reserved }),
      },
      {
        key: "owner",
        label: t("slos.field.owner"),
        value: raw(props.slo.owner) || raw(ABSENT),
      },
    ],
  },
]);

const configJson = computed(() => JSON.stringify(props.slo.config ?? {}, null, 2));
const hasConfigJson = computed(() => Object.keys(props.slo.config ?? {}).length > 0);
</script>
