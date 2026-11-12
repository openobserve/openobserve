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

<template>
  <section
    class="rounded-surface border-border-default bg-surface-base flex flex-col gap-2 border p-4"
    data-test="decision-dismissed"
  >
    <header class="flex flex-wrap items-center gap-2">
      <OText variant="label" as="h2">{{ t("insight.decisions.list.title") }}</OText>
      <OBadge v-if="page.data.value" variant="default-soft" data-test="decision-dismissed-total">
        {{ copy.count(total) }}
      </OBadge>
      <OToggleGroup
        :model-value="kind"
        class="ms-auto shrink-0"
        data-test="decision-dismissed-filter"
        @update:model-value="onKind"
      >
        <OToggleGroupItem
          v-for="option in KINDS"
          :key="option"
          :value="option"
          size="xs"
          :data-test="`decision-dismissed-filter-${option}`"
        >
          {{ t(KIND_FILTER_LABEL[option]) }}
        </OToggleGroupItem>
      </OToggleGroup>
    </header>

    <div v-if="page.isPending.value" class="flex flex-col gap-2">
      <OSkeleton class="rounded-surface h-12 w-full" />
      <OSkeleton class="rounded-surface h-12 w-full" />
    </div>

    <p
      v-else-if="page.isError.value && !page.data.value"
      class="text-status-error-text flex items-center gap-2 text-sm"
      data-test="decision-dismissed-error"
    >
      <OIcon name="error" size="xs" />
      <span>{{ t("insight.decisions.list.loadFailed") }}</span>
      <OButton variant="outline" size="xs" @click="page.refetch()">
        {{ copy.retry() }}
      </OButton>
    </p>

    <OText v-else-if="!rows.length" variant="meta" as="p" data-test="decision-dismissed-empty">
      {{ t(KIND_EMPTY[kind]) }}
    </OText>

    <ul
      v-else
      class="divide-border-default flex flex-col divide-y"
      data-test="decision-dismissed-rows"
    >
      <li
        v-for="row in rows"
        :key="row.decision_id"
        class="flex items-start gap-3 py-2"
        data-test="decision-dismissed-row"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-text-body truncate text-sm font-medium">
            {{ copy.title(row.subject?.title) }}
          </span>
          <OText variant="meta" as="span" data-test="decision-dismissed-summary">
            {{ summary(row) }}
          </OText>
          <OText
            v-if="row.note"
            variant="meta"
            as="span"
            class="break-words"
            data-test="decision-dismissed-note"
          >
            {{ raw(row.note) }}
          </OText>
        </div>
        <OText
          variant="meta"
          as="span"
          class="w-24 shrink-0 truncate pt-0.5"
          data-test="decision-dismissed-kind"
        >
          {{ t(KIND_LABEL[row.family]) }}
        </OText>
        <OButton
          variant="outline"
          size="xs"
          :loading="route.isUndoing(row.decision_id)"
          data-test="decision-dismissed-undo"
          @click="route.undo([{ org: orgId, view: row, title: row.subject?.title ?? null }])"
        >
          {{ copy.undo() }}
        </OButton>
      </li>
    </ul>

    <footer
      v-if="total > PAGE_SIZE"
      class="flex items-center justify-end gap-2"
      data-test="decision-dismissed-pager"
    >
      <OText variant="meta" as="span" data-test="decision-dismissed-range">
        {{
          t("insight.decisions.list.range", {
            from: copy.count(offset + 1),
            to: copy.count(Math.min(offset + PAGE_SIZE, total)),
            total: copy.count(total),
          })
        }}
      </OText>
      <OButton
        variant="outline"
        size="icon-xs"
        icon-left="chevron-left"
        :aria-label="t('insight.decisions.list.previous')"
        :disabled="offset === 0"
        data-test="decision-dismissed-previous"
        @click="offset = Math.max(0, offset - PAGE_SIZE)"
      />
      <OButton
        variant="outline"
        size="icon-xs"
        icon-left="chevron-right"
        :aria-label="t('insight.decisions.list.next')"
        :disabled="offset + PAGE_SIZE >= total"
        data-test="decision-dismissed-next"
        @click="offset += PAGE_SIZE"
      />
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { DecisionFamily, DecisionView } from "@/services/autoobserveDecisions";
import {
  dismissedDecisionsQuery,
  useDecisionRoute,
} from "@/composables/autoobserve/useDecisionRoute";
import { decisionCopy } from "@/components/autoobserve/insight/insightCopy";

/** One screen of rows. */
const PAGE_SIZE = 20;

type Kind = DecisionFamily | "all";

const KINDS: readonly Kind[] = ["all", "suggestion", "alert_finding"];
const KIND_FILTER_LABEL: Record<Kind, I18nKey> = {
  all: "insight.decisions.list.filterAll",
  suggestion: "insight.decisions.list.filterSuggestion",
  alert_finding: "insight.decisions.list.filterAlertFinding",
};
const KIND_LABEL: Record<DecisionFamily, I18nKey> = {
  suggestion: "insight.decisions.kind.suggestion",
  alert_finding: "insight.decisions.kind.alert_finding",
};
const KIND_EMPTY: Record<Kind, I18nKey> = {
  all: "insight.decisions.list.empty",
  suggestion: "insight.decisions.list.emptySuggestion",
  alert_finding: "insight.decisions.list.emptyAlertFinding",
};

const { t, locale } = useI18nTyped();
const orgId = useOrgId();
const store = useStore();
const route = useDecisionRoute();
const copy = computed(() => decisionCopy(t, locale.value));
const offset = ref(0);
const kind = ref<Kind>("all");

const page = useQuery(() =>
  dismissedDecisionsQuery(orgId.value, kind.value === "all" ? null : kind.value),
);
const rows = computed(() =>
  (page.data.value?.decisions ?? []).slice(offset.value, offset.value + PAGE_SIZE),
);
const total = computed(() => page.data.value?.total ?? 0);

function summary(row: DecisionView): I18nText {
  const first = t("insight.decisions.list.summary", {
    reason: copy.value.recordReason(row.reason),
    actor: copy.value.actor(row.actor, store.state.userInfo?.email),
    when: copy.value.when(row.decided_at),
  });
  const until =
    row.until === null
      ? t("insight.decisions.list.untilUndone")
      : t("insight.decisions.list.until", { when: copy.value.when(row.until) });
  return raw(`${first} · ${until}`);
}

function onKind(value: unknown) {
  if (!KINDS.includes(value as Kind)) return;
  kind.value = value as Kind;
  offset.value = 0;
}

// Another org's paging means nothing here.
watch(orgId, () => {
  offset.value = 0;
});

// An undo on the last row of a later page leaves it empty, so step back a page.
watch(
  () => [rows.value.length, total.value] as const,
  ([shown, all]) => {
    if (shown === 0 && all > 0 && offset.value >= all) {
      offset.value = Math.max(0, Math.floor((all - 1) / PAGE_SIZE) * PAGE_SIZE);
    }
  },
);
</script>
