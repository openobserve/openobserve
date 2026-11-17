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

<!-- Proposed actions: inert text; nothing runs from here (README non-goal). -->
<template>
  <section data-test="rca-proposed-actions" :aria-labelledby="headingId" class="flex flex-col">
    <div class="mb-2.5 flex flex-wrap items-baseline gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaSummary.proposedActions") }}
      </h3>
      <span class="text-text-secondary text-xs">
        {{ actions.length }} · {{ t("alerts.incidents.rcaSummary.proposedActionsNote") }}
      </span>
    </div>

    <ol
      class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y border p-0"
    >
      <RcaFoldRow
        v-for="(action, idx) in actions"
        :key="idx"
        data-test="rca-proposed-action"
        :open="opened.has(idx)"
        @update:open="toggle(idx)"
      >
        {{ action.title }}
        <template v-if="action.kind !== 'other'" #meta>
          <span data-test="rca-proposed-action-kind" class="text-text-secondary shrink-0 text-xs">
            {{ rcaActionKindLabel(action.kind) }}
          </span>
        </template>
        <template #body>
          <p
            data-test="rca-proposed-action-detail"
            class="text-text-secondary text-compact m-0 [text-wrap:pretty]"
          >
            {{ action.detail || t("alerts.incidents.rcaSummary.noImpact") }}
          </p>
        </template>
      </RcaFoldRow>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { ref, useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { RcaProposedAction } from "@/services/incidents";
import { rcaActionKindLabel } from "@/utils/incidents/rcaSummary";
import RcaFoldRow from "./RcaFoldRow.vue";

defineProps<{ actions: RcaProposedAction[] }>();

const { t } = useI18nTyped();
const headingId = useId();

const opened = ref(new Set<number>());
const toggle = (idx: number) => {
  const next = new Set(opened.value);
  if (!next.delete(idx)) next.add(idx);
  opened.value = next;
};
</script>
