<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- One event: its entities (each a pivot) and the Sigma rules this exact row matches,
     evaluated server-side. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import { buildRuleCountSql, type RuleHit } from "@/composables/security/useSigmaRules";
import type { Classification } from "@/utils/security/classify";
import { ocsfCategoryOf, ocsfStatusName, type NormalizedEvent } from "@/utils/security/ocsf";
import { sourceColumnFor } from "@/utils/security/normalize";
import { normalizeTactic, techniqueUrl } from "@/utils/security/mitre";
import { eventKey, eventMatchWhere } from "@/utils/security/eventQuery";
import {
  severityTagValue,
  toneLabelKey,
  toneOfSeverityId,
  toneOfSigmaLevel,
} from "@/utils/security/severity";

const props = defineProps<{
  open: boolean;
  event: Record<string, any>;
  /** Position in the result list, for next/previous. */
  index?: number | null;
  total?: number | null;
  normalized: NormalizedEvent;
  detected: Classification | null;
  stream: string;
  orgId: string;
  rules: RuleHit[];
  shareUrl?: string;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "prev"): void;
  (e: "next"): void;
  (e: "add-filter", field: string, value: string, op?: string): void;
}>();

const { t } = useI18n();

// ── Header ───────────────────────────────────────────────────────────────────
const tone = computed(() => toneOfSeverityId(props.normalized.severityId));
const title = computed(
  () =>
    props.normalized.className ||
    props.normalized.activity ||
    props.detected?.source.label ||
    t("siem.drawer.event"),
);
const category = computed(() => ocsfCategoryOf(props.normalized.classUid)?.name ?? "");

/** Compact form for the facts tile; the full date sits in the tooltip. */
function fmtFact(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Entities ─────────────────────────────────────────────────────────────────
interface Entity {
  key: keyof NormalizedEvent;
  label: string;
  icon: IconName;
  value: string;
  field: string | null;
  mono?: boolean;
}

const entities = computed<Entity[]>(() => {
  const n = props.normalized;
  const source = props.detected?.source ?? null;
  const field = (key: keyof NormalizedEvent) => sourceColumnFor(props.event, source, key);
  const withPort = (ip: string, port: string) => (ip && port ? `${ip}:${port}` : ip);
  const list: Entity[] = [
    {
      key: "actor",
      label: t("siem.entity.actor"),
      icon: "person",
      value: n.actor,
      field: field("actor"),
    },
    {
      key: "srcIp",
      label: t("siem.entity.source"),
      icon: "lan",
      value: withPort(n.srcIp, n.srcPort),
      field: field("srcIp"),
      mono: true,
    },
    {
      key: "dstIp",
      label: t("siem.entity.destination"),
      icon: "dns",
      value: withPort(n.dstIp, n.dstPort),
      field: field("dstIp"),
      mono: true,
    },
    {
      key: "host",
      label: t("siem.entity.host"),
      icon: "computer",
      value: n.host,
      field: field("host"),
    },
    {
      key: "process",
      label: t("siem.entity.process"),
      icon: "memory",
      value: n.process,
      field: field("process"),
      mono: true,
    },
    {
      key: "operation",
      label: t("siem.entity.operation"),
      icon: "bolt",
      value: n.operation,
      field: field("operation"),
    },
    {
      key: "resource",
      label: t("siem.entity.resource"),
      icon: "storage",
      value: n.resource,
      field: field("resource"),
      mono: true,
    },
  ];
  return list.filter((e) => e.value);
});

// Filters take the raw column value, not the "ip:port" display string.
function pivotValue(entity: Entity): string {
  const raw = entity.field ? props.event[entity.field] : null;
  return raw == null ? entity.value : String(raw);
}

const outcome = computed(() => ({
  id: props.normalized.statusId,
  name: ocsfStatusName(props.normalized.statusId),
}));

// ── Detections for this event ────────────────────────────────────────────────
const runnable = computed(() => props.rules.filter((r) => r.compiled.runnable));
const matched = ref<RuleHit[]>([]);
const matching = ref(false);
const matchError = ref("");

async function evaluateRules() {
  matched.value = [];
  matchError.value = "";
  const ts = Number(props.event._timestamp);
  // Identity by content: several events can share one timestamp.
  const key = eventKey(props.event);
  // Snapshot: the parent's list re-sorts as rule counts arrive, and `r<i>` in
  // the response refers to the order the query was built in.
  const rules = [...runnable.value];
  if (!rules.length || !Number.isFinite(ts) || !props.stream) return;
  matching.value = true;
  try {
    const sql = `${buildRuleCountSql(
      props.stream,
      rules.map((r) => r.compiled.where),
    )} WHERE ${eventMatchWhere(props.event)}`;
    const res = await searchService.search(
      {
        org_identifier: props.orgId,
        query: {
          query: { sql, start_time: ts - 1_000_000, end_time: ts + 1_000_000, from: 0, size: 1 },
        },
        page_type: "logs",
      },
      "ui",
    );
    // A different event may have been opened while this one was evaluating.
    if (eventKey(props.event) !== key) return;
    const row = res.data?.hits?.[0] ?? {};
    matched.value = rules.filter((_, i) => Number(row[`r${i}`] ?? 0) > 0);
  } catch (e: any) {
    if (eventKey(props.event) !== key) return;
    matchError.value = e?.response?.data?.error ?? e?.message ?? t("siem.drawer.matchError");
  } finally {
    if (eventKey(props.event) === key) matching.value = false;
  }
}

// Separate sources, so a re-ranked rule list (same length) does not re-query.
watch([() => eventKey(props.event), () => runnable.value.length], () => void evaluateRules(), {
  immediate: true,
});

const techniques = computed(() => {
  const seen = new Map<string, string[]>();
  for (const hit of matched.value) {
    for (const id of hit.rule.techniques) {
      if (!seen.has(id)) seen.set(id, hit.rule.tactics);
    }
  }
  return [...seen.entries()].map(([id, tactics]) => ({
    id,
    tactics: tactics.map((x) => normalizeTactic(x)).filter((x): x is NonNullable<typeof x> => !!x),
  }));
});

// ── Fields ───────────────────────────────────────────────────────────────────
const fieldRows = computed<KeyValueRow[]>(() => {
  const flat: KeyValueRow[] = [];
  const walk = (obj: Record<string, any>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) walk(v, key);
      else if (v !== null && v !== undefined && v !== "")
        flat.push({ key, value: Array.isArray(v) ? JSON.stringify(v) : String(v) });
    }
  };
  walk(props.event, "");
  return flat.sort((a, b) => a.key.localeCompare(b.key));
});

const tab = ref<string>("overview");
const tabs = computed<RecordTab[]>(() => [
  { name: "overview", label: t("siem.drawer.overview"), icon: "dashboard" },
  {
    name: "detections",
    label: t("siem.drawer.detections"),
    icon: "shield-alert-outline",
    count: matched.value.length || null,
  },
  {
    name: "fields",
    label: t("siem.drawer.fields"),
    icon: "format-list-bulleted",
    count: fieldRows.value.length,
  },
  { name: "json", label: t("siem.drawer.json"), icon: "data-object" },
]);

const facts = computed<RecordFact[]>(() => [
  { label: t("siem.column.time"), value: fmtFact(props.normalized.time), mono: true },
  { label: t("siem.drawer.source"), value: props.detected?.source.label ?? props.stream },
  { label: t("siem.column.product"), value: props.normalized.product },
  {
    label: t("siem.column.activity"),
    value: props.normalized.activity || props.normalized.operation,
  },
]);

const json = computed(() => JSON.stringify(props.event, null, 2));

function copy(text: string) {
  const fail = () => toast({ variant: "error", message: t("siem.record.copyFailed") });
  // navigator.clipboard is undefined on plain-HTTP deployments.
  if (!navigator.clipboard) {
    fail();
    return;
  }
  navigator.clipboard.writeText(text).catch(fail);
}
</script>

<template>
  <SecurityRecordDrawer
    :open="open"
    v-model:tab="tab"
    :title="title"
    :eyebrow="t('siem.drawer.eyebrow')"
    :subtitle="stream"
    icon="manage-search"
    :tone="tone"
    :facts="facts"
    :tabs="tabs"
    :index="index ?? null"
    :total="total ?? null"
    :share-url="shareUrl"
    data-test="security-event-drawer"
    @close="emit('close')"
    @prev="emit('prev')"
    @next="emit('next')"
  >
    <template #chips>
      <OTag
        type="severity"
        :value="severityTagValue(tone)"
        :label="t(toneLabelKey(tone))"
        size="sm"
        data-test="security-event-drawer-severity"
      />
      <OTag
        v-if="outcome.id === 1 || outcome.id === 2"
        :variant="outcome.id === 2 ? 'error-soft' : 'success-soft'"
        :icon="outcome.id === 2 ? 'cancel' : 'check-circle'"
        size="sm"
        >{{ t(`siem.outcome.${outcome.id === 2 ? "failure" : "success"}`) }}</OTag
      >
      <OTag v-if="category" variant="primary-soft" size="sm">{{ category }}</OTag>
      <OTag v-if="matched.length" variant="error-soft" icon="shield-alert-outline" size="sm">
        {{ t("siem.drawer.matchedRules", matched.length) }}
      </OTag>
    </template>

    <template v-if="normalized.message" #summary>
      <p
        class="text-text-heading bg-surface-subtle rounded-surface line-clamp-4 px-3 py-2.5 font-mono text-xs leading-relaxed"
        data-test="security-event-drawer-message"
      >
        {{ normalized.message }}
      </p>
    </template>

    <!-- ── Overview: the entities, each one a pivot ─────────────────────── -->
    <template #tab-overview>
      <div v-if="entities.length" class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div
          v-for="entity in entities"
          :key="entity.key"
          class="group border-border-default hover:border-accent rounded-surface flex flex-col gap-1 border p-3 transition-colors"
          :data-test="`security-event-drawer-entity-${entity.key}`"
        >
          <div class="text-text-secondary flex items-center gap-1.5 text-xs font-medium">
            <OIcon :name="entity.icon" size="xs" />
            {{ entity.label }}
            <div class="flex-1" />
            <div
              v-if="entity.field"
              class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            >
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="add-circle-outline"
                :data-test="`security-event-drawer-entity-${entity.key}-include`"
                @click="emit('add-filter', entity.field, pivotValue(entity), '=')"
              >
                <OTooltip :content="t('siem.pivot.include')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="block"
                :data-test="`security-event-drawer-entity-${entity.key}-exclude`"
                @click="emit('add-filter', entity.field, pivotValue(entity), '!=')"
              >
                <OTooltip :content="t('siem.pivot.exclude')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="content-copy"
                :data-test="`security-event-drawer-entity-${entity.key}-copy`"
                @click="copy(entity.value)"
              >
                <OTooltip :content="t('siem.pivot.copy')" />
              </OButton>
            </div>
          </div>
          <span
            class="text-text-heading truncate text-sm font-semibold"
            :class="{ 'font-mono': entity.mono }"
            >{{ entity.value }}<OTooltip :content="entity.value"
          /></span>
          <span v-if="entity.field" class="text-text-secondary text-2xs truncate font-mono">{{
            entity.field
          }}</span>
        </div>
      </div>
      <OEmptyState
        v-else
        size="inline"
        icon="info-outline"
        :title="t('siem.drawer.noEntities')"
        :description="t('siem.drawer.noEntitiesHint')"
      />

      <div v-if="detected" class="bg-surface-subtle rounded-surface flex flex-col gap-1.5 p-3">
        <span class="text-text-secondary text-xs font-medium">{{
          t("siem.drawer.classifiedAs")
        }}</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-text-heading text-sm font-semibold">{{ detected.source.label }}</span>
          <OTag variant="primary-soft" size="xs">
            {{ t("siem.events.confidence", { n: Math.round(detected.confidence * 100) }) }}
          </OTag>
          <OTag v-if="normalized.classUid" variant="default-soft" size="xs" class="font-mono">
            {{ t("siem.drawer.classUid", { n: normalized.classUid }) }}
          </OTag>
        </div>
      </div>
    </template>

    <!-- ── Detections: rules that match this exact row ──────────────────── -->
    <template #tab-detections>
      <div v-if="matching" class="flex items-center justify-center gap-2 py-10">
        <OSpinner size="sm" />
        <span class="text-text-secondary text-sm">{{ t("siem.drawer.evaluating") }}</span>
      </div>
      <OEmptyState
        v-else-if="!runnable.length"
        size="inline"
        icon="rule"
        :title="t('siem.drawer.noRules')"
        :description="t('siem.drawer.noRulesHint')"
      />
      <OEmptyState
        v-else-if="matchError"
        size="inline"
        icon="error-outline"
        :title="t('siem.drawer.matchError')"
        :description="matchError"
      />
      <OEmptyState
        v-else-if="!matched.length"
        size="inline"
        icon="task-alt"
        :title="t('siem.drawer.noMatches')"
        :description="t('siem.drawer.noMatchesHint', runnable.length)"
      />
      <template v-else>
        <div
          v-for="hit in matched"
          :key="hit.rule.id ?? hit.rule.title"
          class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
          :data-test="`security-event-drawer-match-${hit.rule.id}`"
        >
          <div class="flex items-start gap-2">
            <OTag
              type="severity"
              :value="severityTagValue(toneOfSigmaLevel(hit.rule.level))"
              :label="t(toneLabelKey(toneOfSigmaLevel(hit.rule.level)))"
              size="xs"
            />
            <span class="text-text-heading min-w-0 flex-1 text-sm font-semibold">{{
              hit.rule.title
            }}</span>
          </div>
          <p v-if="hit.rule.description" class="text-text-secondary text-xs leading-relaxed">
            {{ hit.rule.description }}
          </p>
          <div v-if="hit.rule.techniques.length" class="flex flex-wrap gap-1">
            <OTag
              v-for="tech in hit.rule.techniques"
              :key="tech"
              variant="purple-soft"
              shape="rounded"
              size="xs"
              >{{ tech }}</OTag
            >
          </div>
        </div>

        <div v-if="techniques.length" class="flex flex-col gap-2 pt-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.drawer.attack")
          }}</span>
          <div class="flex flex-col gap-1">
            <div v-for="tech in techniques" :key="tech.id" class="flex items-center gap-2 text-xs">
              <OButton
                as="a"
                :href="techniqueUrl(tech.id)"
                target="_blank"
                rel="noopener"
                variant="ghost-primary"
                size="xs"
                icon-right="open-in-new"
                :data-test="`security-event-drawer-technique-${tech.id}`"
                >{{ tech.id }}</OButton
              >
              <span class="text-text-secondary">
                {{ tech.tactics.map((x) => t(`siem.mitre.tactics.${x}`)).join(" · ") }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <template #tab-fields>
      <SecurityKeyValues
        :rows="fieldRows"
        searchable
        pivotable
        data-test="security-event-drawer-fields"
        @pivot="(field, value, op) => emit('add-filter', field, value, op)"
      />
    </template>

    <template #tab-json>
      <OCodeBlock :code="json" lang="json" data-test="security-event-drawer-json" />
    </template>
  </SecurityRecordDrawer>
</template>
