<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { blockedReason, caveat } from "@/utils/security/compileText";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import { formatEventCount } from "@/utils/formatters";
import type { useSigmaRules } from "@/composables/security/useSigmaRules";

/** What the stream was identified as, and on what evidence. */
export interface DetectedSummary {
  label: string;
  product: string;
  classMix: string;
  objects: string[];
  missing: string;
  confidence: number;
  category: string;
  classUid: number | null;
  className: string;
  sigma: string;
  evidence: string;
  isSecurity: boolean;
}

type RankedRule = ReturnType<typeof useSigmaRules>["ranked"]["value"][number];

defineProps<{
  summary: DetectedSummary;
  rules: RankedRule[];
  counting: boolean;
  error: string;
  runnableCount: number;
  firingCount: number;
  canCreate: boolean;
}>();
const emit = defineEmits<{
  "filter-by-rule": [where: string];
  "create-detection": [sigmaId: string];
}>();
const showRules = defineModel<boolean>("showRules", { default: false });
const { t } = useI18nTyped();
</script>

<template>
  <div
    class="px-page-edge border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b py-1.5 text-xs"
    data-test="security-events-detected"
  >
    <OIcon
      :name="summary.isSecurity ? 'verified-user' : 'info-outline'"
      size="sm"
      :class="summary.isSecurity ? 'text-icon-chip-primary-text' : 'text-text-secondary'"
    />
    <span class="text-text-heading font-semibold">{{ summary.label }}</span>
    <OTag
      v-if="summary.product"
      variant="default-soft"
      size="xs"
      data-test="security-events-product"
      >{{ t("siem.events.product", { name: summary.product }) }}</OTag
    >
    <OTag variant="primary-soft" size="xs">
      {{ t("siem.events.confidence", { n: summary.confidence }) }}
      <OTooltip
        v-if="summary.missing"
        :content="t('siem.events.missingSignals', { fields: summary.missing })"
      />
    </OTag>
    <OTag
      v-if="summary.category"
      variant="default-soft"
      size="xs"
      data-test="security-events-ocsf-category"
      >{{ t("siem.events.ocsfCategory", { name: summary.category }) }}</OTag
    >
    <OTag
      v-if="summary.className"
      variant="default-soft"
      size="xs"
      data-test="security-events-ocsf-class"
      >{{ t("siem.events.ocsfClass", { name: summary.className, uid: summary.classUid })
      }}<OTooltip
        v-if="summary.classMix"
        :content="t('siem.events.classMix', { mix: summary.classMix })"
    /></OTag>
    <OTag
      v-if="summary.objects.length"
      variant="default-soft"
      size="xs"
      data-test="security-events-ocsf-objects"
      >{{ t("siem.events.objects") }} · {{ summary.objects.length
      }}<OTooltip :content="raw(summary.objects.join(', '))"
    /></OTag>
    <OTag
      v-if="summary.sigma"
      variant="purple-soft"
      size="xs"
      class="font-mono"
      data-test="security-events-sigma-logsource"
    >
      {{ t("siem.events.rulesMatch", { logsource: summary.sigma }) }}
      <OTooltip :content="t('siem.events.rulesMatchHint')" />
    </OTag>
    <OTag v-if="!summary.isSecurity" variant="default-soft" size="xs">
      {{ t("siem.events.telemetryOnly") }}
    </OTag>
    <span class="text-text-secondary max-w-md truncate">
      {{ t("siem.events.matchedOn", { fields: summary.evidence }) }}
      <OTooltip :content="raw(summary.evidence)" />
    </span>
    <div class="flex-1" />
    <OButton
      v-if="rules.length"
      :variant="firingCount ? 'outline-destructive' : 'outline'"
      size="xs"
      icon-left="shield-alert-outline"
      :icon-right="showRules ? 'expand-less' : 'expand-more'"
      data-test="security-events-rules-toggle"
      @click="showRules = !showRules"
    >
      {{ t("siem.events.detections", runnableCount) }}
      <template v-if="firingCount"> · {{ t("siem.events.firing", firingCount) }}</template>
      <OTooltip :content="t('siem.events.matchingRulesHint')" />
    </OButton>
  </div>

  <div
    v-if="showRules && rules.length"
    class="border-border-default bg-surface-panel flex max-h-72 shrink-0 flex-col overflow-y-auto border-b"
    data-test="security-events-rules"
  >
    <div class="px-page-edge text-text-secondary flex items-center gap-2 py-1.5 text-xs">
      <span class="font-semibold">{{
        t("siem.events.rulesFor", { source: summary.sigma || "" })
      }}</span>
      <OSpinner v-if="counting" size="xs" />
      <span v-else-if="error" class="text-status-error-text">{{ error }}</span>
    </div>
    <div
      v-for="entry in rules"
      :key="entry.rule.key"
      class="px-page-edge border-border-subtle flex items-center gap-2 border-t py-1.5 text-xs"
      :class="{ 'opacity-60': !entry.compiled.runnable }"
    >
      <OTag
        type="severity"
        :value="severityTagValue(toneOfSigmaLevel(entry.rule.level))"
        :label="t(toneLabelKey(toneOfSigmaLevel(entry.rule.level)))"
        size="xs"
      />
      <span class="text-text-heading truncate font-medium">
        {{ entry.rule.title }}
        <OTooltip v-if="entry.rule.description" :content="raw(entry.rule.description)" />
      </span>
      <OTag
        v-for="tech in entry.rule.techniques.slice(0, 3)"
        :key="tech"
        variant="purple-soft"
        shape="rounded"
        size="xs"
        >{{ tech }}</OTag
      >
      <div class="flex-1" />
      <span v-if="!entry.compiled.runnable" class="text-text-secondary max-w-80 truncate">
        {{ blockedReason(entry.compiled) }}
        <OTooltip :content="blockedReason(entry.compiled)" />
      </span>
      <template v-else>
        <OIcon
          v-if="caveat(entry.compiled)"
          name="warning-amber"
          size="xs"
          class="text-status-warning-text"
        >
          <OTooltip :content="caveat(entry.compiled)" />
        </OIcon>
        <OTag
          v-if="entry.count !== null"
          :variant="entry.count > 0 ? 'error-soft' : 'default-soft'"
          size="xs"
          class="tabular-nums"
        >
          {{ t("siem.events.hits", { n: formatEventCount(entry.count) }, entry.count) }}
        </OTag>
        <OButton
          v-if="entry.count"
          :data-test="`security-events-rule-view-${entry.rule.id}`"
          variant="ghost"
          size="xs"
          @click="emit('filter-by-rule', entry.compiled.where)"
        >
          {{ t("siem.events.viewHits") }}
        </OButton>
        <OButton
          v-if="canCreate"
          :data-test="`security-events-rule-create-${entry.rule.id}`"
          variant="ghost-primary"
          size="xs"
          @click="emit('create-detection', entry.rule.key)"
        >
          {{ t("siem.events.createDetection") }}
        </OButton>
      </template>
    </div>
  </div>
</template>
