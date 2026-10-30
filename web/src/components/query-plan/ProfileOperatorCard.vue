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
    :class="value.on ? '' : 'opacity-40'"
    :style="{ left: `${x}px`, top: `${y}px`, width: `${CARD_W}px`, height: `${CARD_H}px` }"
    data-profile-card
  >
    <template v-if="stacked">
      <div
        class="bg-surface-base border-border-default rounded-default absolute inset-0 translate-x-2 translate-y-2 border"
      />
      <div
        class="bg-surface-base border-border-strong rounded-default absolute inset-0 translate-x-1 translate-y-1 border"
      />
    </template>
    <div
      role="button"
      tabindex="0"
      class="bg-surface-base border-border-default rounded-default focus-visible:ring-accent/40 relative flex h-full cursor-pointer flex-col overflow-hidden border border-s-3 px-2.5 py-2 shadow-sm transition-shadow outline-none hover:shadow-md focus-visible:ring-2"
      :class="[
        style.border,
        selected ? 'ring-accent ring-2' : '',
        model.planOnly ? 'justify-center gap-1.5' : 'justify-between',
      ]"
      :aria-pressed="selected"
      :data-test="`query-profile-card-${op.id}`"
      @click.stop="emit('select', op.id)"
      @keydown.enter.prevent="emit('select', op.id)"
      @keydown.space.prevent="emit('select', op.id)"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="rounded-default grid size-5 shrink-0 place-items-center" :class="style.chip">
          <OIcon :name="style.icon" size="xs" />
        </span>
        <OTruncatedText class="text-text-heading text-compact flex-1 font-semibold">{{
          label
        }}</OTruncatedText>
        <OBadge
          v-if="badge"
          size="xs"
          shape="rounded"
          :variant="badge.variant"
          :data-test="`query-profile-card-${op.id}-badge`"
          >{{ badge.text }}</OBadge
        >
      </div>
      <div class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs tabular-nums">
        <OTruncatedText :class="model.planOnly ? 'font-mono' : ''">{{ subline }}</OTruncatedText>
        <span
          v-if="tag"
          class="bg-surface-subtle rounded-default text-2xs shrink-0 px-1 font-mono whitespace-nowrap"
          >{{ tag }}</span
        >
      </div>
      <template v-if="!model.planOnly">
        <ProfileNodeBars v-if="bars" :bars="bars" />
        <OProgressBar
          v-else
          size="xs"
          :value="Math.max(0.015, share)"
          :variant="SHARE_BAR[shareTone(share)]"
        />
      </template>
    </div>
    <div v-if="refold" class="absolute end-2 top-0 -translate-y-1/2">
      <OButton
        variant="outline"
        size="xs"
        icon-left="compress"
        :aria-label="t('search.queryProfile.foldBackLabel', { op: label })"
        :data-test="`query-profile-card-${op.id}-refold`"
        @click.stop="emit('fold', 'refold')"
        >{{ t("search.queryProfile.foldBack") }}</OButton
      >
    </div>
    <div v-if="branch" class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
      <OButton
        variant="outline"
        size="icon-xs-circle"
        :icon-left="branch === 'open' ? 'remove' : 'add'"
        :aria-label="
          branch === 'open'
            ? t('search.queryProfile.collapseBranch', { op: label })
            : t('search.queryProfile.expandBranch', { op: label })
        "
        :aria-expanded="branch === 'open'"
        :data-test="`query-profile-card-${op.id}-branch`"
        @click.stop="emit('fold', 'branch')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  CARD_H,
  CARD_W,
  formatNs,
  formatPercent,
  formatRows,
  nodeLabel,
  scopeNodeKey,
  scopedValue,
  shareOfTotal,
  shareTone,
  type ProfileModel,
  type ProfileOperator,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileNodeBars from "./ProfileNodeBars.vue";
import { CATEGORY_STYLE, SHARE_BADGE, SHARE_BAR, type NodeBar } from "./profileStyles";
import { nodeName, operatorTitle, planCardDetail, scopeTag } from "./profileText";

const props = defineProps<{
  model: ProfileModel;
  op: ProfileOperator;
  scope: StageScope;
  selected: boolean;
  x: number;
  y: number;
  branch?: "open" | "collapsed" | null;
  refold?: boolean;
}>();

const emit = defineEmits<{ select: [opId: string]; fold: [kind: "branch" | "refold"] }>();

const { t } = useI18nTyped();

const style = computed(() => CATEGORY_STYLE[props.op.category]);
const label = computed(() => operatorTitle(t, props.op));
const share = computed(() => shareOfTotal(props.model, props.op));
const value = computed(() => scopedValue(props.op, props.scope));
const stage = computed(() =>
  props.op.remoteStageId ? props.model.stageById[props.op.remoteStageId] : null,
);
const stacked = computed(() => !!props.op.stageId && props.op.samples.length > 1);

const badge = computed(() => {
  if (stage.value) {
    return {
      variant: "default-soft" as const,
      text: t("search.queryProfile.stage", { index: stage.value.index }),
    };
  }
  if (props.model.planOnly) return null;
  return {
    variant: SHARE_BADGE[shareTone(share.value)],
    text: raw(formatPercent(share.value)),
  };
});

const subline = computed<I18nText>(() => {
  if (props.model.planOnly) return planCardDetail(t, props.model, props.op);
  if (stage.value) {
    return t("search.queryProfile.remoteSubline", {
      wall: formatNs(stage.value.maxWallUs * 1000),
      rows: formatRows(value.value.rows),
    });
  }
  if (!value.value.on) {
    return t("search.queryProfile.notRunOn", {
      node: nodeName(props.model, scopeNodeKey(props.scope) ?? ""),
    });
  }
  return t("search.queryProfile.opSubline", {
    time: formatNs(value.value.computeNs),
    rows: formatRows(value.value.rows),
  });
});

const tag = computed<I18nText | null>(() => {
  if (props.model.planOnly) return null;
  if (stage.value) {
    const count = stage.value.nodes.length;
    return t("search.queryProfile.nodesCount", { count }, count);
  }
  if (!props.op.stageId || !value.value.on || props.op.samples.length < 2) return null;
  return t("search.queryProfile.scopeMultiplier", {
    scope: scopeTag(t, props.model, props.scope),
    count: props.op.samples.length,
  });
});

const bars = computed<NodeBar[] | null>(() => {
  if (stage.value) {
    const max = stage.value.maxWallUs || 1;
    return stage.value.nodes.map((n) => ({
      key: n.key,
      ratio: n.wallUs / max,
      tone: n.straggler ? "hot" : "default",
      title: `${nodeLabel(n)} ${formatNs(n.wallUs * 1000)}`,
    }));
  }
  if (!props.op.stageId || props.op.samples.length < 2) return null;
  const stageNodes = props.model.stageById[props.op.stageId].nodes;
  const max = Math.max(...props.op.samples.map((s) => s.computeNs)) || 1;
  const scoped = scopeNodeKey(props.scope);
  return props.op.samples.map((s) => {
    const node = stageNodes.find((n) => n.key === s.nodeKey);
    const off = scoped !== null && scoped !== s.nodeKey;
    return {
      key: s.nodeKey,
      ratio: s.computeNs / max,
      tone: off ? "off" : node?.straggler ? "hot" : "default",
      title: `${node ? nodeLabel(node) : s.nodeKey} ${formatNs(s.computeNs)}`,
    };
  });
});
</script>
