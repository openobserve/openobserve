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
import { raw, useI18nTyped } from "@/types/i18n";
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

const parts = computed(() =>
  filterSentenceParts(props.group, (n) => describeFilterNode(n, props.dialect, t)),
);
const empty = computed(() => !parts.value.some((p) => p.kind === "condition"));
const connectorWord = (connector: "AND" | "OR") =>
  connector === "OR" ? t("alerts.form.filter.or") : t("alerts.form.filter.and");
</script>

<!-- The whole filter tree as one wrapping sentence; the builder itself opens only from Change or a phrase. -->
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
  <div
    v-else
    class="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm"
    :data-test="props.dataTest"
  >
    <span class="text-text-secondary">{{ t("alerts.form.filter.where") }}</span>
    <template v-for="(part, index) in parts" :key="index">
      <OButton
        v-if="part.kind === 'condition'"
        variant="link"
        size="sm"
        class="h-auto! max-w-full text-start whitespace-normal!"
        :data-test="`${props.dataTest}-condition-${part.id}`"
        @click="emit('edit', part.id)"
      >
        {{ raw(part.text) }}
      </OButton>
      <OButton
        v-else-if="part.kind === 'connector'"
        variant="ghost"
        size="xs"
        :aria-label="
          t('alerts.form.filter.toggleConnector', { connector: connectorWord(part.connector) })
        "
        :data-test="`${props.dataTest}-connector-${part.id}`"
        @click="emit('toggleConnector', part.id)"
      >
        {{ connectorWord(part.connector) }}
      </OButton>
      <span v-else class="text-text-secondary">{{ part.kind === "open" ? OPEN : CLOSE }}</span>
    </template>
    <span class="ms-1 flex items-center gap-1">
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
