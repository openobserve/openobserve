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
    data-test="rca-evidence-card"
    class="rounded-default border-border-default bg-surface-subtle flex flex-col overflow-hidden border"
  >
    <div
      v-if="withHeader"
      class="border-border-default bg-surface-base flex items-center gap-2 border-b px-3 py-2"
    >
      <span
        class="rounded-default border-border-control text-3xs inline-grid h-5 min-w-5.5 place-items-center border px-1 font-mono font-semibold"
      >
        {{ entry.number }}
      </span>
      <OIcon :name="rcaEvidenceKindIcon(entry.kind)" size="sm" class="text-icon-color" />
      <span class="text-text-secondary text-3xs font-mono font-bold uppercase">
        {{ entry.kind }}
      </span>
      <span class="text-text-heading text-compact min-w-0 flex-1 font-semibold">
        {{ title }}
      </span>
      <RcaPill :tone="entry.decisive ? 'strong' : 'neutral'">
        {{ weightLabel }}
      </RcaPill>
    </div>

    <pre
      v-if="query"
      data-test="rca-evidence-query"
      class="text-text-body m-0 px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
      >{{ query }}</pre>

    <ul
      v-if="entry.citations.length > 0"
      data-test="rca-evidence-citations"
      class="border-border-default m-0 flex list-none flex-col gap-2 border-t px-3 py-2.5"
    >
      <li
        v-for="{ citation, target } in citationRows"
        :key="`${citation.hypothesis_id}:${citation.evidence_id}`"
        data-test="rca-evidence-citation"
        class="flex flex-col gap-0.5 text-xs"
      >
        <!-- "Decisive · supports the root cause": the weight first, the hypothesis a link. -->
        <span class="text-text-secondary flex min-w-0 items-baseline gap-1">
          <span class="shrink-0">
            <span class="text-text-heading font-semibold">{{
              strengthLabel(citation.strength)
            }}</span>
            · {{ polarityLabel(citation.polarity) }}
          </span>
          <button
            v-if="target"
            type="button"
            data-test="rca-evidence-citation-hypothesis"
            class="text-accent min-w-0 cursor-pointer truncate border-none bg-transparent p-0 text-start font-semibold hover:underline"
            :title="target.statement"
            @click="$emit('open-hypothesis', citation.hypothesis_id)"
          >
            <RcaInlineText :text="target.label" />
          </button>
        </span>
        <span class="text-text-body">
          <span class="text-text-secondary font-semibold">{{
            t("alerts.incidents.rcaSummary.agentsReading")
          }}</span
          >{{ " " }}<RcaInlineText :text="citation.observation" />
        </span>
      </li>
    </ul>

    <div
      class="border-border-default bg-surface-base flex flex-wrap items-center gap-2 border-t py-1.5 ps-3 pe-2 text-xs"
    >
      <span data-test="rca-evidence-result" class="text-text-secondary min-w-0 flex-1">
        {{ entry.result_summary }}
        <span v-if="source" class="text-text-secondary">· {{ source }}</span>
      </span>
      <OButton
        v-if="link"
        data-test="rca-evidence-open"
        variant="ghost-primary"
        size="sm"
        icon-left="open-in-new"
        @click="router.push(link.route)"
      >
        {{ openLabel }}
      </OButton>
      <OButton
        v-if="query"
        data-test="rca-evidence-copy"
        variant="ghost-muted"
        size="sm"
        icon-left="content-copy"
        @click="copyQuery"
      >
        {{ t("alerts.incidents.rcaSummary.copyQuery") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaCitation,
  RcaEvidenceEntry,
  RcaPolarity,
  RcaStrength,
  RcaSummaryHypothesis,
} from "@/services/incidents";
import { rcaEvidenceLink, rcaEvidenceQuery } from "@/utils/incidents/rcaEvidenceLinks";
import { rcaEvidenceKindIcon, rcaEvidenceTitle, rcaUtcRange } from "@/utils/incidents/rcaSummary";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";

const props = withDefaults(
  defineProps<{
    entry: RcaEvidenceEntry;
    hypotheses: RcaSummaryHypothesis[];
    /** The card opens under this hypothesis: its own citation needs no name. */
    hypothesisId?: string | null;
    org: string;
    /** Inline cards carry their own header; index rows already show it. */
    withHeader?: boolean;
  }>(),
  { hypothesisId: null, withHeader: false },
);

defineEmits<{
  /** A citation's hypothesis link: show that hypothesis. */
  "open-hypothesis": [hypothesisId: string];
}>();

const { t } = useI18nTyped();
const router = useRouter();

const link = computed(() => rcaEvidenceLink(props.entry.link, props.org));
const query = computed(() => rcaEvidenceQuery(props.entry.link));

/** "Logs · checkout_api": the target and its streams. */
const title = computed<I18nText>(() => rcaEvidenceTitle(props.entry));

const weightLabel = computed(() =>
  props.entry.decisive
    ? t("alerts.incidents.rcaSummary.decisive")
    : t("alerts.incidents.rcaSummary.supporting"),
);

/** "checkout_api · 14:02:11–14:35:00 UTC"; the result summary already carries the query time. */
const source = computed(() => {
  const parts: string[] = [];
  if (props.entry.link.streams.length > 0) parts.push(props.entry.link.streams.join(", "));
  const range = rcaUtcRange(props.entry.link.start_us, props.entry.link.end_us);
  if (range) parts.push(range);
  return raw(parts.join(" · "));
});

const openLabel = computed(() => {
  switch (link.value?.page) {
    case "metrics":
      return t("alerts.incidents.rcaSummary.openInMetrics");
    case "traces":
      return t("alerts.incidents.rcaSummary.openInTraces");
    default:
      return t("alerts.incidents.rcaSummary.openInLogs");
  }
});

/** A role name links a citation when only one hypothesis holds that role, else its statement does. */
const citationRows = computed(() => {
  const byId = new Map(props.hypotheses.map((h) => [h.id, h]));
  const perStatus = new Map<string, number>();
  for (const h of props.hypotheses) perStatus.set(h.status, (perStatus.get(h.status) ?? 0) + 1);
  const roleOf = (h: RcaSummaryHypothesis): I18nText | null => {
    if ((perStatus.get(h.status) ?? 0) > 1) return null;
    if (h.status === "root_cause") return t("alerts.incidents.rcaSummary.citesRootCause");
    if (h.status === "contributing") return t("alerts.incidents.rcaSummary.citesContributing");
    return null;
  };
  return props.entry.citations.map((citation: RcaCitation) => {
    if (citation.hypothesis_id === props.hypothesisId) return { citation, target: null };
    const found = byId.get(citation.hypothesis_id);
    if (!found) return { citation, target: null };
    return {
      citation,
      target: { label: roleOf(found) ?? raw(found.statement), statement: found.statement },
    };
  });
});

const polarityLabel = (polarity: RcaPolarity): I18nText => {
  switch (polarity) {
    case "supports":
      return t("alerts.incidents.rcaSummary.polarity.supports");
    case "contradicts":
      return t("alerts.incidents.rcaSummary.polarity.contradicts");
    case "rules_out":
      return t("alerts.incidents.rcaSummary.polarity.rulesOut");
  }
};

const strengthLabel = (strength: RcaStrength): I18nText =>
  strength === "decisive"
    ? t("alerts.incidents.rcaSummary.decisive")
    : t("alerts.incidents.rcaSummary.supporting");

const copyQuery = async () => {
  if (!query.value) return;
  try {
    await navigator.clipboard.writeText(query.value);
    toast({ variant: "success", message: t("alerts.incidents.rcaSummary.queryCopied") });
  } catch (error) {
    console.error("Failed to copy to the clipboard:", error);
    toast({ variant: "error", message: t("alerts.incidents.rcaSummary.queryCopyFailed") });
  }
};
</script>
