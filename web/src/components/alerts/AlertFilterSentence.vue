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
import { computed, h } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import type { FilterGroup } from "@/utils/query/filterBar";
import { describeFilterNode, filterSentenceParts } from "@/utils/alerts/filterSentence";
import { dataNoun } from "@/utils/alerts/alertCopy";

const props = defineProps<{
  group: FilterGroup;
  streamName: string;
  /** Names what the stream holds: events, samples or spans. */
  streamType?: string;
  dialect: string;
  dataTest: string;
  /** Renders as a full-width setting row; Change and Remove stay inline after the sentence. */
  label?: I18nText;
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
const noun = computed(() => dataNoun(props.streamType, "custom", 2, t));
const connectorWord = (connector: "AND" | "OR") =>
  connector === "OR" ? t("alerts.form.filter.or") : t("alerts.form.filter.and");

const actionButton = (key: "change" | "remove") =>
  h(
    OButton,
    {
      variant: "ghost-primary",
      size: "sm",
      "data-test": `${props.dataTest}-${key}`,
      onClick: () => (key === "change" ? emit("change") : emit("remove")),
    },
    () => (key === "change" ? t("alerts.form.change") : t("common.remove")),
  );
const SentenceActions = () => [actionButton("change"), actionButton("remove")];
</script>

<!-- The whole filter tree as one wrapping sentence; inline flow, so word spaces come from the text itself. -->
<template>
  <component
    :is="props.label ? OSettingRow : 'div'"
    v-bind="
      props.label ? { label: props.label, dataTest: `${props.dataTest}-row`, wide: true } : {}
    "
  >
    <div
      class="flex flex-wrap items-center gap-x-2 gap-y-1"
      :class="empty && 'text-sm'"
      :data-test="props.dataTest"
    >
      <template v-if="empty">
        <span class="text-text-body">{{
          props.streamName
            ? t("alerts.form.filter.allEvents", { noun, stream: raw(props.streamName) })
            : t("alerts.form.filter.allEventsNoStream", { noun })
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
      </template>
      <template v-else>
        <p class="text-text-body m-0 text-sm leading-6">
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
                t('alerts.form.filter.toggleConnector', {
                  connector: connectorWord(part.connector),
                })
              "
              :data-test="`${props.dataTest}-connector-${part.id}`"
              @click="emit('toggleConnector', part.id)"
              >{{ connectorWord(part.connector) }}</OButton
            ></template
          >
        </p>
        <span class="flex shrink-0 items-center gap-1"><SentenceActions /></span>
      </template>
      <div v-if="$slots.trail" class="ms-auto flex shrink-0 items-center">
        <slot name="trail" />
      </div>
    </div>
  </component>
</template>
