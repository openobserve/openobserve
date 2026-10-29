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

<!-- Cost of a trace or session. When some tokens have no price the cost is a
     lower bound ("≥ $X partial"); when none do it reads "cost unknown" instead
     of $0. The tooltip names the unpriced models and links to the fix. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { costKind, pricingGapsRoute } from "./llmDataTrust.utils";

const props = withDefaults(
  defineProps<{
    cost: number;
    tokens: number;
    unpricedTokens?: number;
    unpricedModels?: string[];
    scope: "session" | "trace";
    /** Trace stream, for the "Add a price" link. */
    stream?: string;
    format?: (cost: number) => string;
  }>(),
  {
    unpricedTokens: 0,
    unpricedModels: () => [],
    stream: "",
    format: (cost: number) => `$${cost.toFixed(4)}`,
  },
);

const { t } = useI18nTyped();
const store = useStore();

const kind = computed(() => costKind(props.cost, props.tokens, props.unpricedTokens));

const tooltip = computed(() => {
  const models = props.unpricedModels.length
    ? props.unpricedModels.join(", ")
    : t("llmDataTrust.cost.unknownModel");
  const params = {
    models,
    tokens: props.unpricedTokens.toLocaleString(),
    scope:
      props.scope === "session"
        ? t("llmDataTrust.cost.scopeSession")
        : t("llmDataTrust.cost.scopeTrace"),
  };
  return kind.value === "unknown"
    ? t("llmDataTrust.cost.unknownTooltip", params)
    : t("llmDataTrust.cost.partialTooltip", params);
});

const fixRoute = computed(() =>
  pricingGapsRoute(props.stream, store.state.selectedOrganization?.identifier ?? ""),
);
</script>

<template>
  <span v-if="kind === 'exact'" class="tabular-nums" data-test="llm-cost-cell">{{
    format(cost)
  }}</span>
  <span
    v-else
    class="inline-flex items-center gap-1 whitespace-nowrap tabular-nums"
    data-test="llm-cost-cell"
    :data-cost-kind="kind"
  >
    <template v-if="kind === 'partial'">
      <span>{{ t("llmDataTrust.cost.atLeast", { cost: format(cost) }) }}</span>
      <OBadge variant="warning-soft" size="sm" data-test="llm-cost-cell-partial">{{
        t("llmDataTrust.cost.partial")
      }}</OBadge>
    </template>
    <span v-else class="text-text-secondary italic" data-test="llm-cost-cell-unknown">{{
      t("llmDataTrust.cost.unknown")
    }}</span>
    <OTooltip hoverable max-width="18rem">
      <template #content>
        <div class="flex flex-col gap-1">
          <span>{{ raw(tooltip) }}</span>
          <router-link
            :to="fixRoute"
            class="text-text-link hover:text-text-link-hover underline"
            data-test="llm-cost-cell-add-price"
            @click.stop
            >{{ t("llmDataTrust.cost.addPrice") }}</router-link
          >
        </div>
      </template>
    </OTooltip>
  </span>
</template>
