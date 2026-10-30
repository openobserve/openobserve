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
  <div
    class="absolute"
    :style="{
      left: `${fold.x}px`,
      top: `${fold.y}px`,
      width: `${CARD_W}px`,
      height: `${FOLD_H}px`,
    }"
    data-profile-card
  >
    <div
      role="button"
      tabindex="0"
      class="bg-surface-subtle border-border-strong rounded-default hover:border-accent focus-visible:ring-accent/40 flex h-full cursor-pointer flex-col justify-center gap-0.5 border border-dashed px-2.5 outline-none focus-visible:ring-2"
      :data-test="`query-profile-fold-${fold.key}`"
      @click.stop="emit('open')"
      @keydown.enter.prevent="emit('open')"
      @keydown.space.prevent="emit('open')"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="text-text-secondary shrink-0"><OIcon name="unfold-more" size="xs" /></span>
        <OTruncatedText class="text-text-heading text-xs font-semibold">{{ title }}</OTruncatedText>
        <OBadge v-if="straggler" size="xs" shape="rounded" variant="error-soft">{{
          t("search.queryProfile.straggler")
        }}</OBadge>
      </div>
      <OTruncatedText class="text-text-secondary text-2xs">{{ sub }}</OTruncatedText>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import {
  CARD_W,
  FOLD_H,
  formatNs,
  formatPercent,
  type LayoutFold,
  type ProfileModel,
} from "@/utils/queryProfile";
import { foldSummary } from "@/utils/queryProfileFold";
import { operatorTitle } from "./profileText";

const props = defineProps<{
  model: ProfileModel;
  fold: LayoutFold;
}>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();

const summary = computed(() => foldSummary(props.model, props.fold));
const stage = computed(() => {
  if (props.fold.kind !== "stage") return null;
  const stageId = props.model.operators[props.fold.ownerId]?.remoteStageId;
  return stageId ? props.model.stageById[stageId] : null;
});
const straggler = computed(() => !!stage.value?.nodes.some((n) => n.straggler));

const title = computed<I18nText>(() => {
  if (stage.value && props.model.planOnly) {
    return t("search.queryProfile.stage", { index: stage.value.index });
  }
  if (stage.value) {
    const count = stage.value.nodes.length;
    return t("search.queryProfile.foldStage", {
      index: stage.value.index,
      nodes: t("search.queryProfile.nodesCount", { count }, count),
    });
  }
  const count = props.fold.kind === "branch" ? summary.value.count : props.fold.opIds.length;
  if (props.fold.kind === "branch") return t("search.queryProfile.foldHidden", { count }, count);
  return props.fold.focus
    ? t("search.queryProfile.foldOutsideFocus", { count }, count)
    : t("search.queryProfile.foldBranches", { count }, count);
});

const sub = computed<I18nText>(() => {
  if (props.model.planOnly) return t("search.queryProfile.foldShowHint");
  const total = props.model.totalComputeNs;
  const pct = formatPercent(total > 0 ? summary.value.computeNs / total : 0);
  if (stage.value) {
    return t("search.queryProfile.foldStageSub", {
      wall: formatNs(stage.value.maxWallUs * 1000),
      pct,
    });
  }
  const hottest = summary.value.hottest;
  if (!hottest) return t("search.queryProfile.foldCpu", { pct });
  return t("search.queryProfile.foldCpuHottest", {
    pct,
    op: operatorTitle(t, hottest),
    opPct: formatPercent(total > 0 ? hottest.totalComputeNs / total : 0),
  });
});
</script>
