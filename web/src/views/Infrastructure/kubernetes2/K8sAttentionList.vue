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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatAge } from "./kubernetesModel";
import { KIND_INFO } from "./kubernetesQueries";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import type { AttentionItem } from "./overviewModel";

const props = defineProps<{
  items: AttentionItem[];
  total: number;
  loading: boolean;
  // µs
  endUs: number;
}>();

const emit = defineEmits<{
  open: [ref: DetailsRef];
  action: [type: "logs" | "explain", ref: DetailsRef];
  navigate: [patch: Partial<K8sUrlState>];
}>();

const { t } = useI18nTyped();

const rows = computed(() =>
  props.items.map((item) => ({
    item,
    kindLine: raw([t(KIND_INFO[item.kind].title), item.namespace].filter(Boolean).join(" · ")),
    reasonLine: reasonLine(item),
  })),
);

function reasonLine(item: AttentionItem): I18nText {
  const parts: string[] = [...item.reasons];
  if (item.kind === "node") parts.push(t("infra.k8s2.warnNodeNotReady"));
  else if (item.notReady && !parts.length) parts.push(t("infra.k8s2.overviewAttentionNotReady"));
  if (item.restarts) {
    parts.push(t("infra.k8s2.overviewAttentionRestarts", { count: item.restarts }, item.restarts));
  }
  if (item.sinceUs != null && item.sinceUs <= props.endUs) {
    parts.push(
      t("infra.k8s2.overviewAttentionFor", { age: formatAge(props.endUs - item.sinceUs) }),
    );
  } else if (item.createdAt != null) {
    const age = formatAge(props.endUs - item.createdAt);
    parts.push(t("infra.k8s2.overviewAttentionAge", { age }));
  }
  return raw(parts.join(" · "));
}
</script>

<template>
  <section
    class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col border"
    data-test="k8s2-overview-attention-card"
  >
    <div class="flex min-w-0 items-baseline gap-2 p-3">
      <OText variant="card-title">{{ t("infra.k8s2.overviewAttentionTitle") }}</OText>
      <OText variant="meta" class="text-text-secondary">{{
        t("infra.k8s2.overviewAttentionSub")
      }}</OText>
      <span
        v-if="total > items.length"
        class="ms-auto flex items-center gap-1"
        data-test="k8s2-overview-attention-showing"
      >
        <OText variant="meta" class="text-text-secondary">{{
          t("infra.k8s2.overviewAttentionShowing", { shown: items.length })
        }}</OText>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="k8s2-overview-attention-all"
          @click="emit('navigate', { view: 'pods', status: 'failing' })"
          >{{ raw(String(total)) }}</OButton
        >
      </span>
    </div>
    <div v-if="loading" class="flex flex-col gap-3 p-3" data-test="k8s2-overview-attention-loading">
      <OSkeleton v-for="n in 3" :key="n" type="text" class="h-9" />
    </div>
    <OEmptyState
      v-else-if="!items.length"
      size="inline"
      preset="no-data"
      :title="t('infra.k8s2.overviewAttentionEmptyTitle')"
      :description="t('infra.k8s2.overviewAttentionEmptyDesc')"
      data-test="k8s2-overview-attention-empty"
    />
    <ul v-else class="m-0 flex list-none flex-col p-0">
      <li
        v-for="row in rows"
        :key="row.item.key"
        class="border-border-default hover:bg-surface-subtle flex min-w-0 cursor-pointer items-center gap-3 border-t px-3 py-2"
        :data-test="`k8s2-overview-attention-row-${row.item.key}`"
        @click="emit('open', row.item.ref)"
      >
        <span
          class="size-2.5 shrink-0 rounded-full"
          :class="row.item.severity === 'error' ? 'bg-status-negative' : 'bg-status-warning-text'"
          :data-test="`k8s2-overview-attention-dot-${row.item.key}`"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-baseline gap-2">
            <OButton
              variant="ghost-primary"
              size="xs"
              class="min-w-0 font-medium"
              :data-test="`k8s2-overview-attention-open-${row.item.key}`"
              @click.stop="emit('open', row.item.ref)"
              ><OTruncatedText>{{ raw(row.item.name) }}</OTruncatedText></OButton
            >
            <OTruncatedText class="text-text-secondary shrink-0 text-xs max-md:hidden">{{
              row.kindLine
            }}</OTruncatedText>
          </div>
          <OTruncatedText
            class="text-text-secondary text-xs"
            :data-test="`k8s2-overview-attention-reason-${row.item.key}`"
            >{{ row.reasonLine }}</OTruncatedText
          >
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <OButton
            v-if="row.item.canLogs"
            variant="outline"
            size="sm"
            icon-left="article"
            :data-test="`k8s2-overview-attention-logs-${row.item.key}`"
            @click.stop="emit('action', 'logs', row.item.ref)"
          >
            {{ t("infra.k8s2.overviewAttentionLogs") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="auto-awesome"
            disabled
            focusable-unavailable
            :data-test="`k8s2-overview-attention-explain-${row.item.key}`"
          >
            {{ t("infra.k8s2.overviewAttentionExplain") }}
            <OTooltip :content="t('infra.k8s2.overviewAttentionExplainUnavailable')" />
          </OButton>
        </div>
      </li>
    </ul>
  </section>
</template>
