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

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FilterGroup } from "@/utils/query/filterBar";
import { describeFilterNode, filterSentenceParts } from "@/utils/alerts/filterSentence";

const props = defineProps<{
  group: FilterGroup;
  streamName: string;
  dialect: string;
  dataTest: string;
}>();

const emit = defineEmits<{
  (e: "add"): void;
  (e: "change"): void;
  (e: "remove"): void;
  (e: "edit", id: string): void;
  (e: "toggleConnector", id: string): void;
}>();

const { t } = useI18nTyped();
const OPEN = raw("(");
const CLOSE = raw(")");
const SPACE = raw(" ");
const brackets = (bracket: I18nText, count: number) => raw(bracket.repeat(count));

const parts = computed(() =>
  filterSentenceParts(props.group, (n) => describeFilterNode(n, props.dialect, t)),
);
const empty = computed(() => !parts.value.some((p) => p.kind === "condition"));
const connectorWord = (connector: "AND" | "OR") =>
  connector === "OR" ? t("alerts.form.filter.or") : t("alerts.form.filter.and");
</script>

<!-- The whole filter tree as one wrapping sentence; inline flow, so word spaces come from the text itself. -->
<template>
  <div
    v-if="empty"
    class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    :data-test="props.dataTest"
  >
    <span class="text-text-body">{{
      t("alerts.form.filter.allEvents", { stream: raw(props.streamName) })
    }}</span>
    <OButton
      variant="ghost-primary"
      size="sm"
      icon-left="add"
      data-test="add-alert-add-filters"
      @click="emit('add')"
    >
      {{ t("alerts.tiers.add.filters") }}
    </OButton>
  </div>
  <div v-else class="flex flex-wrap items-center gap-x-2 gap-y-1" :data-test="props.dataTest">
    <p class="text-text-body m-0 min-w-0 text-sm leading-6">
      <span class="text-text-secondary">{{ t("alerts.form.filter.where") }}</span>
      <template v-for="part in parts" :key="`${part.kind}-${part.id}`"
        >{{ SPACE
        }}<span v-if="part.kind === 'condition'" class="whitespace-nowrap"
          ><span v-if="part.opens" class="text-text-secondary">{{
            brackets(OPEN, part.opens)
          }}</span
          ><OButton
            variant="phrase"
            size="sm"
            :data-test="`${props.dataTest}-condition-${part.id}`"
            @click="emit('edit', part.id)"
            ><template v-if="part.phrase.field"
              ><code class="bg-surface-subtle rounded-default px-1 wrap-anywhere">{{
                raw(part.phrase.field)
              }}</code
              >{{ SPACE }}{{ raw(part.phrase.operator)
              }}<template v-if="part.phrase.value"
                >{{ SPACE
                }}<strong class="text-text-heading font-semibold wrap-anywhere">{{
                  raw(part.phrase.value)
                }}</strong></template
              ></template
            ><template v-else>{{ raw(part.phrase.text) }}</template></OButton
          ><span v-if="part.closes" class="text-text-secondary">{{
            brackets(CLOSE, part.closes)
          }}</span></span
        ><OButton
          v-else
          variant="phrase"
          size="sm"
          class="text-text-secondary"
          :aria-label="
            t('alerts.form.filter.toggleConnector', { connector: connectorWord(part.connector) })
          "
          :data-test="`${props.dataTest}-connector-${part.id}`"
          @click="emit('toggleConnector', part.id)"
          >{{ connectorWord(part.connector) }}</OButton
        ></template
      >
    </p>
    <span class="flex shrink-0 items-center gap-1">
      <OButton
        variant="ghost-primary"
        size="sm"
        :data-test="`${props.dataTest}-change`"
        @click="emit('change')"
      >
        {{ t("alerts.form.change") }}
      </OButton>
      <OButton
        variant="ghost-primary"
        size="sm"
        :data-test="`${props.dataTest}-remove`"
        @click="emit('remove')"
      >
        {{ t("common.remove") }}
      </OButton>
    </span>
  </div>
</template>
