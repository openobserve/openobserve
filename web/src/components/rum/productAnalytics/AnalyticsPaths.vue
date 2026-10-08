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
  <div class="px-page-edge flex flex-col gap-3 py-3" data-test="rum-analytics-paths">
    <OCard variant="outlined" class="rounded-surface flex flex-col">
      <div class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span v-if="!def.cohort" class="flex w-80 items-center gap-2 max-md:w-full">
          <span class="text-text-secondary text-xs">{{ t("rum.analytics.pathsView.from") }}</span>
          <StepPicker
            class="min-w-0 flex-1"
            :model-value="def.anchor"
            :placeholder="t('rum.analytics.pathsView.pickAnchor')"
            :events="events"
            data-test="rum-analytics-paths-anchor-select"
            @update:model-value="(s) => s && update({ anchor: s })"
          />
        </span>
        <OTag
          v-else
          :label="cohortLabel"
          variant="warning-soft"
          size="md"
          removable
          data-test="rum-analytics-paths-session-filter"
          @remove="clearCohort"
        />
        <OToggleGroup
          :model-value="def.direction"
          type="single"
          data-test="rum-analytics-paths-direction-toggle"
          @update:model-value="(v) => v && update({ direction: v as 'next' | 'prev' })"
        >
          <OToggleGroupItem value="next" size="xs" data-test="rum-analytics-paths-direction-next">{{
            t("rum.analytics.pathsView.next")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="prev" size="xs" data-test="rum-analytics-paths-direction-prev">{{
            t("rum.analytics.pathsView.previous")
          }}</OToggleGroupItem>
        </OToggleGroup>
        <OSelect
          :model-value="def.depth"
          :options="depthOptions"
          size="sm"
          class="w-28"
          data-test="rum-analytics-paths-depth-select"
          @update:model-value="(v) => update({ depth: Number(v) })"
        />
        <OToggleGroup
          :model-value="def.include"
          type="single"
          mobile-dropdown
          data-test="rum-analytics-paths-include-toggle"
          @update:model-value="(v) => v && update({ include: v as PathsInclude })"
        >
          <OToggleGroupItem value="all" size="xs" data-test="rum-analytics-paths-include-all">{{
            t("rum.analytics.pathsView.includeAll")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="pages" size="xs" data-test="rum-analytics-paths-include-pages">{{
            t("rum.analytics.pathsView.includePages")
          }}</OToggleGroupItem>
          <OToggleGroupItem
            value="clicks"
            size="xs"
            data-test="rum-analytics-paths-include-clicks"
            >{{ t("rum.analytics.pathsView.includeClicks") }}</OToggleGroupItem
          >
        </OToggleGroup>
        <span class="ms-auto flex items-center gap-1 text-xs"
          ><span class="text-text-secondary max-lg:hidden">{{
            t("rum.analytics.pathsView.caption")
          }}</span
          ><span class="text-text-body" data-test="rum-analytics-paths-click-hint">{{
            t("rum.analytics.pathsView.clickHint")
          }}</span></span
        >
      </div>
      <div class="px-4 py-3">
        <OBanner
          v-if="flow && flow.truncated"
          variant="info"
          dense
          class="mb-2"
          :content="
            t('rum.analytics.pathsView.truncated', {
              pct: shownPct,
              anchor: formatCount(flow.anchorSessions, ratio),
            })
          "
          data-test="rum-analytics-paths-truncated"
        />
        <NamedEventsNotice
          v-if="eventsBlocked"
          :status="eventsStatus"
          data-test="rum-analytics-paths"
          @retry="pa.retryEvents()"
        />
        <OEmptyState
          v-else-if="anchorIssue === 'none'"
          preset="no-search-results"
          size="block"
          :title="t('rum.analytics.pathsView.noAnchorTitle')"
          :description="t('rum.analytics.pathsView.noAnchorDescription')"
          data-test="rum-analytics-paths-no-anchor"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="md"
              data-test="rum-analytics-paths-no-anchor-widen-range-btn"
              @click="widenRange"
              >{{ t("rum.analytics.overview.widenRange") }}</OButton
            >
          </template>
        </OEmptyState>
        <AnalyticsPanelState
          v-else
          :state="shownPanel"
          data-test="rum-analytics-paths"
          :skeleton-rows="8"
          @retry="compute(true)"
        >
          <OEmptyState
            v-if="!flow || !flow.anchorSessions"
            preset="no-search-results"
            size="block"
            :title="t('rum.analytics.pathsView.emptyTitle', { anchor: raw(anchorLabel) })"
            :description="t('rum.analytics.pathsView.emptyDescription')"
            data-test="rum-analytics-paths-empty"
          >
            <template #actions>
              <OButton
                variant="outline"
                size="md"
                data-test="rum-analytics-paths-widen-range-btn"
                @click="widenRange"
                >{{ t("rum.analytics.overview.widenRange") }}</OButton
              >
            </template>
          </OEmptyState>
          <PathsFlow
            v-else
            :flow="flow"
            series-id="rum-analytics-paths"
            :selected="selectedLink"
            :direction="def.direction"
            :events="events"
            @select="onFlowSelect"
          />
        </AnalyticsPanelState>
      </div>
    </OCard>

    <OCard
      v-if="flow && flow.anchorSessions"
      variant="outlined"
      class="rounded-surface overflow-hidden"
    >
      <div class="border-border-default flex items-baseline gap-2 border-b px-4 py-2">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.pathsView.topPaths")
        }}</span>
        <span class="text-text-secondary text-xs">{{
          t(
            "rum.analytics.pathsView.topPathsCaption",
            { count: formatCount(flow.anchorSessions, ratio), anchor: raw(anchorLabel) },
            flow.anchorSessions,
          )
        }}</span>
      </div>
      <TopPathsTable
        :rows="pathsPanel.rows"
        :anchor-sessions="flow.anchorSessions"
        :depth="def.depth"
        :anchor-key="anchorKey"
        :direction="def.direction"
        :events="events"
        :sampled="ratio"
        @select="onTupleSelect"
      />
    </OCard>

    <PathSessionsDrawer
      v-if="branch"
      :open="!!branch"
      :def="def"
      :predicate="branch.predicate"
      :step-depth="branch.stepDepth"
      :title="branch.title"
      :expected-total="ratio > 1 ? null : branch.expectedTotal"
      :sampled="ratio"
      :events="events"
      :path-keys="branch.pathKeys"
      @update:open="(v) => !v && (branch = null)"
      @build-funnel="buildFunnel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import NamedEventsNotice from "@/components/rum/productAnalytics/NamedEventsNotice.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import PathsFlow, { type FlowSelection } from "@/components/rum/productAnalytics/PathsFlow.vue";
import TopPathsTable from "@/components/rum/productAnalytics/TopPathsTable.vue";
import PathSessionsDrawer from "@/components/rum/productAnalytics/PathSessionsDrawer.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useFunnelDraft, { emptyFunnel } from "@/composables/rum/useFunnelDraft";
import useAnalyticsSearch, { type PanelState } from "@/composables/rum/useAnalyticsSearch";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  branchPredicate,
  buildPathFlow,
  formatCount,
  pathKeyLabel,
  pathStepLabel,
  type BranchTarget,
  type NamedEvent,
  type PathFlow,
} from "@/utils/rum/productAnalyticsModel";
import {
  dropoffHealthSql,
  pathsSql,
  type PathsDef,
  type PathsInclude,
  type SampleRatio,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

defineOptions({ name: "AnalyticsPaths" });

interface Branch {
  predicate: string;
  stepDepth: number;
  title: I18nText;
  expectedTotal: number | null;
  pathKeys: string[];
}

const { t } = useI18nTyped();
const router = useRouter();
const pa = useProductAnalytics();
const funnelDraft = useFunnelDraft();
const runner = useAnalyticsSearch();

const pathsPanel = runner.panel<Record<string, string | number | null>>("paths");
const cohortPanel = runner.panel<{ side: string; units: number; sessions: number }>("cohort");
const namedEvents = useNamedEvents();
const events = computed<NamedEvent[]>(() => [...namedEvents.events.value]);
const branch = ref<Branch | null>(null);
const selectedLink = ref<string | null>(null);
// Why no default anchor could be picked: a failed lookup, or no entry page in range.
const anchorIssue = ref<PanelState<unknown> | "none" | null>(null);
let lastKey = "";
let active = true;
let activatedOnce = false;

const def = computed(() => pa.paths.value);
const usesEvents = computed(() => {
  const d = def.value;
  return d.cohort ? d.cohort.funnel.steps.some((s) => s.kind === "e") : d.anchor?.kind === "e";
});
const eventsStatus = computed(() => (usesEvents.value ? pa.eventsStatus.value : "ready"));
const eventsBlocked = computed(
  () => eventsStatus.value === "failed" || eventsStatus.value === "forbidden",
);
const ratio = computed<SampleRatio>(() =>
  def.value.cohort?.funnel.unit === "users" && pa.identitySql.value ? 1 : pa.sampleRatio.value,
);

const depthOptions = computed(() =>
  [1, 2, 3, 4, 5].map((d) => ({
    label: t("rum.analytics.pathsView.steps", { count: d }),
    value: d,
  })),
);

const anchorKey = computed(() => {
  const d = def.value;
  if (d.cohort) {
    const s = d.cohort.funnel.steps[d.cohort.stepIndex - 1];
    return s ? `${s.kind}:${s.key}` : "";
  }
  return d.anchor ? `${d.anchor.kind}:${d.anchor.key}` : "";
});

const anchorLabel = computed(() => {
  const d = def.value;
  const s = d.cohort ? d.cohort.funnel.steps[d.cohort.stepIndex - 1] : d.anchor;
  return s ? stepLabel(s, events.value) : "";
});

const shownPanel = computed<PanelState<unknown>>(() =>
  anchorIssue.value && anchorIssue.value !== "none" ? anchorIssue.value : pathsPanel.value,
);

const flow = computed<PathFlow | null>(() =>
  pathsPanel.value.status === "ok"
    ? buildPathFlow(pathsPanel.value.rows, def.value.depth, def.value.direction, anchorKey.value)
    : null,
);

const shownPct = computed(() => {
  const f = flow.value;
  if (!f || !f.anchorSessions) return "0.0";
  const shown = pathsPanel.value.rows.reduce((a, r) => a + (Number(r.sessions) || 0), 0);
  return ((shown / f.anchorSessions) * 100).toFixed(1);
});

const cohortLabel = computed(() => {
  const c = def.value.cohort;
  if (!c) return raw("");
  const dropped = cohortPanel.value.rows.find((r) => r.side === "dropped");
  const unit =
    c.funnel.unit === "users" && pa.identitySql.value
      ? pa.usersUnit.value.noun
      : t("rum.analytics.funnel.sessionNoun");
  return dropped
    ? t("rum.analytics.pathsView.cohort", {
        step: c.stepIndex,
        label: raw(anchorLabel.value),
        sessions: formatCount(Number(dropped.sessions), ratio.value),
        units: formatCount(Number(dropped.units), ratio.value),
        unit,
      })
    : t("rum.analytics.pathsView.cohortPending", {
        step: c.stepIndex,
        label: raw(anchorLabel.value),
      });
});

const update = (patch: Partial<PathsDef>) => {
  pa.paths.value = { ...def.value, ...patch };
};

const clearCohort = () => {
  const c = def.value.cohort;
  const s = c ? c.funnel.steps[c.stepIndex - 1] : null;
  update({ cohort: null, anchor: s ?? def.value.anchor });
};

const ensureAnchor = async (): Promise<boolean> => {
  if (def.value.anchor || def.value.cohort) {
    anchorIssue.value = null;
    return true;
  }
  try {
    const rows = await pa.entryExit();
    const top = [...rows].sort((a, b) => Number(b.entry_sessions) - Number(a.entry_sessions))[0];
    if (top?.k) {
      anchorIssue.value = null;
      update({ anchor: { kind: "p", key: String(top.k) } });
      return false;
    }
    anchorIssue.value = "none";
  } catch (e) {
    const state = (e as { state?: PanelState<unknown> }).state;
    // A read superseded by a newer scope says nothing; that scope's own run decides.
    if (state?.status === "loading" || state?.status === "aborted") return false;
    anchorIssue.value = state ?? {
      status: "error",
      rows: [],
      error: { message: String((e as Error).message) },
      partial: null,
      key: null,
      sampled: 1,
    };
  }
  return false;
};

const hold = (status: "idle" | "loading") => {
  lastKey = "";
  branch.value = null;
  selectedLink.value = null;
  runner.hold("paths", status);
  runner.hold("cohort", "idle");
};

const compute = async (force = false) => {
  await pa.loadScope();
  if (pa.scopeStatus.value !== "ok" || !pa.state.app) return;
  if (eventsStatus.value === "loading") hold("loading");
  const gate = await pa.eventsGate(() => usesEvents.value);
  if (!active) return;
  if (gate !== "ready") {
    hold(gate === "loading" ? "loading" : "idle");
    void pa.syncUrl(router);
    return;
  }
  if (!(await ensureAnchor())) return;
  const d = def.value;
  const anchorRules =
    d.anchor?.kind === "e" ? events.value.find((e) => e.id === d.anchor?.key)?.rules : null;
  const key = `${pa.scopeKey.value}|${pa.identitySql.value?.excluded.length ?? ""}|${JSON.stringify(d)}|${ratio.value}|${JSON.stringify(anchorRules ?? null)}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  branch.value = null;
  selectedLink.value = null;
  void pa.syncUrl(router);
  const cur = pa.resolveRange();
  const opts = { events: events.value, sample: ratio.value };
  const jobs: Promise<unknown>[] = [
    runner.run(
      "paths",
      {
        sql: pathsSql(pa.scope.value, pa.identitySql.value, d, opts),
        ...cur,
        limit: 5000,
        sampled: ratio.value,
      },
      key,
    ),
  ];
  if (d.cohort) {
    jobs.push(
      runner.run(
        "cohort",
        {
          sql: dropoffHealthSql(
            pa.scope.value,
            pa.identitySql.value,
            d.cohort.funnel,
            d.cohort.stepIndex,
            opts,
          ),
          ...cur,
          limit: 2,
          sampled: ratio.value,
        },
        key,
      ),
    );
  }
  await Promise.all(jobs);
};

const nodeValue = (name: string) => flow.value?.nodes.find((n) => n.name === name)?.value ?? null;

const linkValue = (source: string, target: string) =>
  flow.value?.links.find((l) => l.source === source && l.target === target)?.value ?? null;

// A link already carries the full chain of keys from the anchor to its target; a box can be fed by
// several links with different histories, so it falls back to the heaviest one as the representative path.
const pathKeysTo = (targetName: string, sourceName: string | null): string[] => {
  const f = flow.value;
  if (!f) return [];
  const incoming = f.links.filter((l) => l.target === targetName);
  const exact = sourceName ? incoming.find((l) => l.source === sourceName) : null;
  if (exact) return exact.pathKeys;
  if (!incoming.length) return [];
  return incoming.reduce((a, b) => (b.value > a.value ? b : a)).pathKeys;
};

const onFlowSelect = (sel: FlowSelection) => {
  const f = flow.value;
  if (!f) return;
  const parentName = sel.depth === 1 ? `0:${anchorKey.value}` : `${sel.depth - 1}:${sel.parentKey}`;
  const targetName =
    sel.type === "other"
      ? `${sel.depth}:__other__`
      : sel.type === "exit"
        ? `${sel.depth}:__exit__`
        : `${sel.depth}:${sel.key}`;
  const viaParent = sel.parentKey !== null || (sel.type !== "node" && sel.depth === 1);
  const expected =
    sel.type === "node" || !viaParent ? nodeValue(targetName) : linkValue(parentName, targetName);
  const target: BranchTarget = {
    depth: sel.depth,
    key: sel.key,
    parentKey: sel.parentKey,
    type: sel.type,
  };
  selectedLink.value = sel.type === "node" ? null : `${parentName}->${targetName}`;
  const title = pathKeyLabel(
    {
      kind:
        sel.type === "other"
          ? "other"
          : sel.type === "exit"
            ? def.value.direction === "next"
              ? "exit"
              : "start"
            : "p",
      key: sel.key ?? "",
      keys: f.nodes.find((n) => n.name === targetName)?.keys,
    },
    events.value,
  );
  // "other"/"exit" nodes carry no real key of their own, so the chain ends at their parent instead.
  const chainEnd = sel.type === "other" || sel.type === "exit" ? parentName : targetName;
  const chainSource = sel.type === "link" ? parentName : null;
  branch.value = {
    predicate: branchPredicate(f, target),
    stepDepth: sel.type === "exit" ? sel.depth - 1 : sel.depth,
    title: raw(title),
    expectedTotal: expected,
    pathKeys: pathKeysTo(chainEnd, chainSource),
  };
};

const onTupleSelect = (sel: { type: "tuple"; tuple: (string | null)[] }) => {
  const f = flow.value;
  if (!f) return;
  const firstNull = sel.tuple.indexOf(null);
  const steps = (firstNull === -1 ? sel.tuple : sel.tuple.slice(0, firstNull)) as string[];
  const row = pathsPanel.value.rows.find((r) =>
    sel.tuple.every((k, i) => (r[`s${i + 1}`] ?? null) === k),
  );
  branch.value = {
    predicate: branchPredicate(f, {
      depth: sel.tuple.length,
      key: null,
      parentKey: null,
      type: "tuple",
      tuple: sel.tuple,
    }),
    stepDepth: steps.length,
    title: raw(
      [anchorLabel.value, ...steps.map((k) => pathStepLabel(k, events.value))].join(" → "),
    ),
    expectedTotal: row ? Number(row.sessions) : null,
    pathKeys: steps,
  };
};

const buildFunnel = (steps: StepRef[]) => {
  if (!steps.length) return;
  branch.value = null;
  void funnelDraft.startNew({ ...emptyFunnel(), steps });
};

const widenRange = () => pa.widenRange(router);

watch(
  () => [
    pa.paths.value,
    pa.scopeKey.value,
    pa.identitySql.value?.excluded.length,
    namedEvents.events.value,
    pa.eventsStatus.value,
  ],
  () => {
    if (active) void compute();
  },
  { deep: true },
);

watch(
  () => pa.refreshTick.value,
  () => {
    if (active) void compute(true);
  },
);

onMounted(() => {
  void compute();
});

onActivated(() => {
  active = true;
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  void runner.rerunAborted();
  void compute();
});

onDeactivated(() => {
  active = false;
  runner.abortAll();
});

onBeforeUnmount(() => runner.abortAll());
</script>
