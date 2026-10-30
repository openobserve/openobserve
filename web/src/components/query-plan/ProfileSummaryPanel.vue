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
  <div class="flex flex-col gap-3.5" data-test="query-profile-summary">
    <h3 class="text-text-heading m-0 text-sm font-semibold">
      {{ t("search.queryProfile.title") }}
    </h3>

    <div class="grid grid-cols-2 gap-1.5">
      <ProfileStatTile
        :label="t('search.queryProfile.wallTime')"
        :value="formatTime(summary.wallMs)"
        data-test="query-profile-tile-wall"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.cpuAllNodes')"
        :value="formatNs(summary.totalComputeNs)"
        data-test="query-profile-tile-cpu"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.resultRows')"
        :value="formatRows(summary.resultRows)"
        data-test="query-profile-tile-rows"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.peakMemory')"
        :value="summary.peakMemory ? formatBytes(summary.peakMemory.bytes) : '—'"
        :sub="
          summary.peakMemory
            ? t('search.queryProfile.peakMemoryNode', { node: summary.peakMemory.node })
            : undefined
        "
        data-test="query-profile-tile-memory"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.nodes')"
        :value="nodesValue"
        :sub="t('search.queryProfile.leaderNode', { node: summary.leaderName })"
        data-test="query-profile-tile-nodes"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.scanned')"
        :value="
          summary.scanned
            ? t(
                'search.queryProfile.scannedFiles',
                { count: summary.scanned.files },
                summary.scanned.files,
              )
            : '—'
        "
        :sub="
          summary.scanned
            ? t('search.queryProfile.scannedDetail', {
                bytes: formatBytes(summary.scanned.bytes),
                rows: formatRows(summary.scanned.rows),
              })
            : undefined
        "
        data-test="query-profile-tile-scanned"
      />
    </div>

    <section v-if="phaseSegments.length">
      <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
        {{ t("search.queryProfile.queryPhases") }}
      </h4>
      <ProfileStackBar :segments="phaseSegments" data-test="query-profile-phases" />
    </section>

    <section v-if="categorySegments.length">
      <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
        {{ t("search.queryProfile.timeByType") }}
      </h4>
      <ProfileStackBar :segments="categorySegments" data-test="query-profile-categories" />
    </section>

    <section v-if="hotspots.length">
      <h4 class="text-text-secondary m-0 mb-1 text-xs font-semibold">
        {{ t("search.queryProfile.hotspots") }}
      </h4>
      <div
        v-for="h in hotspots"
        :key="h.id"
        role="button"
        tabindex="0"
        class="rounded-default hover:bg-surface-subtle focus-visible:ring-accent/40 flex cursor-pointer flex-col gap-1 px-1 py-1.5 outline-none focus-visible:ring-2"
        :class="h.id === selectedId ? 'bg-surface-subtle' : ''"
        :data-test="`query-profile-hotspot-${h.id}`"
        @click="emit('select', h.id)"
        @keydown.enter.prevent="emit('select', h.id)"
        @keydown.space.prevent="emit('select', h.id)"
      >
        <div class="flex min-w-0 items-center gap-2 text-xs">
          <OTruncatedText class="text-text-body">{{ h.label }}</OTruncatedText>
          <span
            v-if="h.where"
            class="bg-surface-subtle text-text-secondary rounded-default text-2xs shrink-0 px-1"
            >{{ h.where }}</span
          >
          <span class="text-text-secondary ms-auto shrink-0 whitespace-nowrap tabular-nums">{{
            h.value
          }}</span>
        </div>
        <OProgressBar size="xs" :value="h.share" :variant="h.variant" />
      </div>
    </section>

    <section v-if="summary.timeline.rows.length">
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <h4 class="text-text-secondary m-0 text-xs font-semibold">
          {{ t("search.queryProfile.nodeTimeline") }}
        </h4>
        <div class="text-text-secondary text-2xs flex flex-wrap items-center gap-2">
          <span v-for="s in model.stages" :key="s.id" class="flex items-center gap-1">
            <span class="size-2 rounded-full" :class="stageSwatch(s.index)" />
            {{ t("search.queryProfile.stage", { index: s.index }) }}
          </span>
        </div>
      </div>
      <div
        v-for="row in timelineRows"
        :key="row.nodeKey"
        role="button"
        tabindex="0"
        class="rounded-default hover:bg-surface-subtle focus-visible:ring-accent/40 grid cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)_3.25rem] items-center gap-1.5 px-1 py-0.5 text-xs outline-none focus-visible:ring-2"
        :class="row.active ? 'bg-surface-accent-active' : ''"
        :aria-pressed="row.active"
        :data-test="`query-profile-timeline-${row.nodeKey}`"
        @click="toggleNode(row.nodeKey)"
        @keydown.enter.prevent="toggleNode(row.nodeKey)"
        @keydown.space.prevent="toggleNode(row.nodeKey)"
      >
        <OTruncatedText class="text-text-body">{{ row.name }}</OTruncatedText>
        <span class="bg-surface-subtle rounded-default relative h-2">
          <span
            v-for="seg in row.segments"
            :key="seg.key"
            class="rounded-default absolute top-0 h-full"
            :class="seg.swatch"
            :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
          />
        </span>
        <span class="text-text-secondary text-end tabular-nums">{{ row.duration }}</span>
      </div>
    </section>

    <div
      v-for="s in summary.stragglers"
      :key="`${s.stageIndex}-${s.nodeKey}`"
      class="bg-surface-subtle text-text-body rounded-default px-2.5 py-2 text-xs leading-normal"
      data-test="query-profile-straggler-note"
    >
      {{
        t("search.queryProfile.stragglerNote", {
          node: s.name,
          stage: s.stageIndex,
          duration: formatNs(s.wallUs * 1000),
          ratio: s.ratio.toFixed(1),
        })
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTime } from "@/utils/queryPlanParser";
import {
  formatBytes,
  formatNs,
  formatPercent,
  formatRows,
  nodeScope,
  operatorLabel,
  scopeNodeKey,
  shareOfTotal,
  shareTone,
  type ProfileModel,
  type ProfileSummary,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileStackBar from "./ProfileStackBar.vue";
import ProfileStatTile from "./ProfileStatTile.vue";
import {
  CATEGORY_STYLE,
  PHASE_STYLE,
  SHARE_BAR,
  STRAGGLER_SWATCH,
  stageSwatch,
  type StackSegment,
} from "./profileStyles";
import { variantLabel } from "./profileText";

const props = defineProps<{
  model: ProfileModel;
  summary: ProfileSummary;
  scope: StageScope;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [opId: string];
  scope: [scope: StageScope];
}>();

const { t } = useI18nTyped();

const phaseSegments = computed<StackSegment[]>(() =>
  (props.summary.phases ?? []).map((p) => ({
    id: p.id,
    value: p.ms,
    swatch: PHASE_STYLE[p.id].swatch,
    label: t(PHASE_STYLE[p.id].labelKey),
    display: formatTime(p.ms),
  })),
);

const categorySegments = computed<StackSegment[]>(() => {
  const total = props.summary.totalComputeNs || 1;
  return props.summary.byCategory.map((c) => ({
    id: c.category,
    value: c.ns,
    swatch: CATEGORY_STYLE[c.category].swatch,
    label: t(CATEGORY_STYLE[c.category].labelKey),
    display: formatPercent(c.ns / total),
  }));
});

const nodesValue = computed(() => {
  const c = props.summary.nodeCounts;
  // all-in-one nodes hold both roles, so a role split would double count them
  if (c.queriers + c.ingesters !== c.total) {
    return t("search.queryProfile.nodesCount", { count: c.total }, c.total);
  }
  return t("search.queryProfile.nodesByRole", { queriers: c.queriers, ingesters: c.ingesters });
});

const hotspots = computed(() =>
  props.summary.hotspots.map((id) => {
    const op = props.model.operators[id];
    const share = shareOfTotal(props.model, op);
    const variant = op.variantId ? props.model.variantById[op.variantId] : null;
    const where: I18nText | null =
      variant && op.stageId
        ? raw(
            `${t("search.queryProfile.stage", { index: props.model.stageById[op.stageId].index })} · ${variantLabel(t, variant)}`,
          )
        : null;
    return {
      id,
      label: raw(operatorLabel(op)),
      where,
      value: `${formatNs(op.totalComputeNs)} · ${formatPercent(share)}`,
      share,
      variant: SHARE_BAR[shareTone(share)],
    };
  }),
);

const activeNode = computed(() => scopeNodeKey(props.scope));

const timelineRows = computed(() => {
  const span = props.summary.timeline.spanUs || 1;
  return props.summary.timeline.rows.map((row) => ({
    nodeKey: row.nodeKey,
    name: raw(row.name),
    active: activeNode.value === row.nodeKey,
    duration: formatNs(row.durationUs * 1000),
    segments: row.segments.map((seg) => ({
      key: `${seg.stageIndex}`,
      swatch: seg.straggler ? STRAGGLER_SWATCH : stageSwatch(seg.stageIndex),
      left: (seg.startUs / span) * 100,
      width: Math.max(0.5, ((seg.endUs - seg.startUs) / span) * 100),
    })),
  }));
});

function toggleNode(nodeKey: string) {
  emit("scope", activeNode.value === nodeKey ? "sum" : nodeScope(nodeKey));
}
</script>
