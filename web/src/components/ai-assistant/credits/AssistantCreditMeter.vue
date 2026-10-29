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
    v-if="status === 'loading'"
    class="flex min-h-5 items-center"
    data-test="assistant-credit-meter"
    data-state="loading"
  >
    <OSkeleton type="text" :class="compact ? 'w-24' : 'w-full'" />
  </div>
  <div
    v-else
    role="group"
    :aria-label="view.sentence"
    class="flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    data-test="assistant-credit-meter"
    :data-state="status"
    :data-mode="usage?.mode"
  >
    <!-- Compact, the tab stop is one image named by the value; the group already speaks the sentence -->
    <span
      :tabindex="compact ? 0 : undefined"
      :role="compact ? 'img' : undefined"
      :aria-label="compact ? (bar?.text ?? text ?? undefined) : undefined"
      :class="[
        'rounded-default focus-visible:ring-border-strong flex min-w-0 items-center gap-2 outline-none focus-visible:ring-2',
        compact ? TOUCH_TARGET_CLASS : 'flex-1 flex-wrap',
      ]"
    >
      <OProgressBar
        v-if="bar"
        :value="bar.value"
        :variant="bar.variant"
        :size="compact ? 'xs' : 'sm'"
        :class="['motion-reduce:[&>div]:transition-none', compact ? 'w-16 shrink-0' : 'w-full']"
        :aria-label="t('assistant.credits.meter.barName')"
        :aria-valuetext="bar.text"
        data-test="assistant-credit-meter-bar"
      />
      <OText
        v-if="text"
        variant="meta"
        as="span"
        class="min-w-0 break-words"
        :aria-hidden="compact ? undefined : 'true'"
        data-test="assistant-credit-meter-text"
      >
        {{ text }}
      </OText>
      <OTooltip v-if="compact" :content="view.sentence" />
    </span>
    <OTag
      v-if="tag"
      :variant="tag.variant"
      :label="t(tag.key)"
      size="sm"
      data-test="assistant-credit-meter-mode"
    />
    <AssistantCreditManage
      v-if="manageable"
      :org="orgName"
      variant="ghost"
      id-prefix="assistant-credit-meter"
    />
    <OButton
      v-if="!usage"
      variant="ghost"
      size="sm"
      :class="TOUCH_TARGET_CLASS"
      data-test="assistant-credit-meter-retry"
      @click="emit('retry')"
    >
      {{ t("assistant.credits.meter.retry") }}
    </OButton>
  </div>
</template>

<script lang="ts">
import type { AssistantUsage } from "@/services/assistant";
import type { PaidOverageStatus } from "@/services/paidOverage";

export interface AssistantCreditMeterProps {
  usage: AssistantUsage | null;
  overage: PaidOverageStatus | null;
  status: "loading" | "ready" | "partial" | "error";
  canManage: boolean;
  orgName: string;
  size: "compact" | "card";
}

export interface AssistantCreditMeterEmits {
  (e: "retry"): void;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import type { CreditMode } from "@/composables/assistant";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { formatCount, formatOrgDay } from "@/utils/formatters";

import AssistantCreditManage from "./AssistantCreditManage.vue";

interface MeterView {
  sentence: I18nText;
  /** The strip's shorter text; `null` where the bar and the tag already say it. */
  compact: I18nText | null;
  /** What the bar fills with, never past the limit. */
  barUsed: number | null;
  variant: ProgressBarVariant;
}

// Never a "Free" tag: `consent_required` must not read as free, and `free` needs no badge.
const TAGS: Partial<Record<CreditMode, { variant: BadgeVariant; key: I18nKey }>> = {
  consent_required: { variant: "warning-soft", key: "assistant.credits.modeTag.consent" },
  pay_as_you_go: { variant: "primary-soft", key: "assistant.credits.modeTag.payg" },
  exhausted: { variant: "error-soft", key: "assistant.credits.modeTag.exhausted" },
};

const props = defineProps<AssistantCreditMeterProps>();
const emit = defineEmits<AssistantCreditMeterEmits>();

const { t } = useI18nTyped();

const compact = computed(() => props.size === "compact");
const n = (value: number) => raw(formatCount(value));
// A failed usage read still names the mode the overage read implies.
const mode = computed<CreditMode | null>(
  () => props.usage?.mode ?? (props.overage?.effective ? "pay_as_you_go" : null),
);
const tag = computed(() => (mode.value ? (TAGS[mode.value] ?? null) : null));

const row = (
  sentence: I18nText,
  compact: I18nText | null,
  barUsed: number | null = null,
  variant: ProgressBarVariant = "neutral",
): MeterView => ({ sentence, compact, barUsed, variant });

const view = computed<MeterView>(() => {
  const usage = props.usage;
  if (!usage)
    return row(
      t("assistant.credits.meter.unavailable"),
      t("assistant.credits.meter.unavailableCompact"),
    );
  const { credits_used: used, credits_limit: limit } = usage;
  const none = t("assistant.credits.meter.noIncluded");
  if (limit <= 0) return row(none, none);
  const full = t("assistant.credits.meter.compact", { used: n(limit), limit: n(limit) });
  switch (usage.mode) {
    case "free": {
      const renewal =
        usage.resetsAt === undefined
          ? t("assistant.credits.meter.noRenew")
          : t("assistant.credits.meter.resets", { date: raw(formatOrgDay(usage.resetsAt)) });
      const nums = { used: n(used), limit: n(limit) };
      const sentence = t("assistant.credits.meter.free", { ...nums, renewal });
      const variant = used >= limit * 0.7 ? "warning" : "neutral";
      return row(sentence, t("assistant.credits.meter.compact", nums), used, variant);
    }
    case "consent_required":
      return row(t("assistant.credits.meter.consent"), full, limit, "warning");
    case "pay_as_you_go": {
      const billed = n(Math.max(0, used - limit));
      const sentence = t("assistant.credits.meter.payg", { limit: n(limit), billed });
      return row(sentence, null, Math.min(used, limit), "default");
    }
    default: {
      const sentence = t("assistant.credits.meter.exhausted", { org: raw(props.orgName) });
      return row(sentence, t("assistant.credits.meter.exhaustedCompact"), limit, "danger");
    }
  }
});

const text = computed(() => (compact.value ? view.value.compact : view.value.sentence));

const bar = computed(() => {
  const { barUsed, variant } = view.value;
  const limit = props.usage?.credits_limit ?? 0;
  if (barUsed === null || limit <= 0) return null;
  return {
    value: Math.min(1, barUsed / limit),
    variant,
    text: t("assistant.credits.meter.value", {
      used: n(Math.min(barUsed, limit)),
      limit: n(limit),
    }),
  };
});

const manageable = computed(() => {
  const usage = props.usage;
  if (!props.canManage || !usage || usage.credits_limit <= 0) return false;
  return usage.mode !== "free" || usage.credits_used >= usage.credits_limit * 0.7;
});
</script>
