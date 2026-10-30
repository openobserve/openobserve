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

<!-- Function details panel beside the Profiles results; the header copies the Traces span sidebar. -->
<template>
  <aside class="bg-surface-panel flex min-h-0 flex-col" data-test="profiles-function-details">
    <div class="border-border-default flex h-8 shrink-0 items-center gap-1 border-b ps-3 pe-1">
      <OTruncatedText class="text-text-body min-w-0 flex-1 font-mono text-xs font-medium">{{
        name
      }}</OTruncatedText>
      <OButton
        variant="ghost"
        size="icon-chip"
        icon-left="content-copy"
        :aria-label="t('profiles.copyFunctionName')"
        data-test="profiles-function-details-copy"
        @click="emit('copy', name)"
      >
        <OTooltip :content="t('profiles.copyFunctionName')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-chip"
        icon-left="close"
        :aria-label="t('common.close')"
        data-test="profiles-function-details-close"
        @click="emit('close')"
      />
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <template v-if="packageName">
          <dt class="text-text-secondary">{{ t("profiles.package") }}</dt>
          <dd
            class="text-text-body min-w-0 font-mono break-all"
            data-test="profiles-function-details-package"
          >
            {{ packageName }}
          </dd>
        </template>
        <dt class="text-text-secondary">{{ t("profiles.self") }}</dt>
        <dd class="text-text-body font-mono" data-test="profiles-function-details-self">
          {{ valueFormatter(self) }} · {{ percentOf(self, grandTotal) }}
        </dd>
        <dt class="text-text-secondary">{{ t("profiles.total") }}</dt>
        <dd class="text-text-body font-mono" data-test="profiles-function-details-total">
          {{ valueFormatter(total) }} · {{ percentOf(total, grandTotal) }}
        </dd>
        <dt class="text-text-secondary">{{ t("profiles.callPaths") }}</dt>
        <dd class="text-text-body font-mono">{{ callPaths }}</dd>
      </dl>
      <p
        v-if="coverage"
        class="text-text-secondary text-xs"
        data-test="profiles-function-details-coverage"
      >
        {{ t("profiles.treeCoverage", { percent: coverage }) }}
      </p>
      <p
        v-if="folded"
        class="text-text-secondary text-xs"
        data-test="profiles-function-details-folded"
      >
        {{ t("profiles.treeFolded") }}
      </p>

      <section
        v-for="list in lists"
        :key="list.id"
        class="flex flex-col gap-1"
        :data-test="`profiles-function-details-${list.id}`"
      >
        <h3 class="text-text-secondary text-xs font-semibold">{{ list.title }}</h3>
        <p v-if="!list.rows.length" class="text-text-secondary text-xs">—</p>
        <!-- Share first, so the numbers line up on the left as in the tables. -->
        <div
          v-for="row in list.rows"
          :key="row.name"
          class="grid grid-cols-[3.5rem_1fr] items-baseline gap-2 text-xs"
        >
          <span class="text-text-secondary font-mono tabular-nums">{{
            percentOf(row.total, list.total)
          }}</span>
          <OTruncatedText class="text-text-body min-w-0 font-mono">{{ row.name }}</OTruncatedText>
        </div>
      </section>

      <div class="flex flex-wrap gap-2">
        <OButton
          variant="outline"
          size="sm"
          icon-left="swap-vert"
          data-test="profiles-function-details-sandwich"
          @click="emit('sandwich', name)"
          >{{ t("profiles.showCallersAndCallees") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm"
          icon-left="flame"
          data-test="profiles-function-details-show"
          @click="emit('show', name)"
          >{{ t("profiles.showInFlameGraph") }}</OButton
        >
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { packageOf } from "@/components/common/flameGraphPackage";
import { useI18nTyped } from "@/types/i18n";
import type { CallNode } from "./sandwich";
import { formatPercent } from "./format";

const LIST_SIZE = 5;

const props = defineProps<{
  name: string;
  self: number;
  total: number;
  /** All samples in the result, for the % values. */
  grandTotal: number;
  /** Frames with this name in the drawn call tree. */
  callPaths: number;
  /** Share of the samples the call tree holds, when it is not all of them. */
  coverage: string;
  /** The call tree folded some callees into this function's self time, so Calls is incomplete. */
  folded: boolean;
  callers: CallNode | null;
  callees: CallNode | null;
  valueFormatter: (value: number) => string;
}>();
const emit = defineEmits<{
  close: [];
  copy: [name: string];
  sandwich: [name: string];
  show: [name: string];
}>();

const { t } = useI18nTyped();

const percentOf = (value: number, of: number) => formatPercent(value, of, "—");

// packageOf falls back to the whole name when it has no package separator, which is not a package.
const packageName = computed(() => {
  const name = packageOf(props.name);
  return name === props.name ? "" : name;
});

// Direct callers and callees, as a share of the samples that pass through this function.
const lists = computed(() => [
  {
    id: "called-by",
    title: t("profiles.calledBy"),
    total: props.callers?.total ?? 0,
    rows: (props.callers?.children ?? []).slice(0, LIST_SIZE),
  },
  {
    id: "calls",
    title: t("profiles.calls"),
    total: props.callees?.total ?? 0,
    rows: (props.callees?.children ?? []).slice(0, LIST_SIZE),
  },
]);
</script>
