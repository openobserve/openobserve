<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type {
  CompositeAlertChild,
  CompositeAlertReadableChild,
  CompositeAlertValidationResponse,
} from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";
import { type CompositeChildOption, letterFor, tokenizeExpression } from "./expression";

const props = defineProps<{
  preview: CompositeAlertValidationResponse | Record<string, unknown>;
  expression?: string;
  selectedChildren?: CompositeChildOption[];
}>();

const { t } = useI18nTyped();
const value = computed(() => props.preview as unknown as CompositeAlertValidationResponse);
const rows = computed(() => value.value.children ?? []);
const expression = computed(() => props.expression ?? "");
const selectedChildren = computed(() => props.selectedChildren ?? []);

const childById = computed(
  () => new Map(selectedChildren.value.map((child) => [child.alert_id, child])),
);
const letterById = computed(
  () => new Map(selectedChildren.value.map((child, index) => [child.alert_id, letterFor(index)])),
);
const previewChildById = computed(
  () => new Map(value.value.children.map((child) => [child.alert_id, child])),
);
const tokens = computed(() => tokenizeExpression(expression.value));
const operandTokens = computed(() => tokens.value.filter((token) => token.kind === "operand"));
// The human-facing expression ("A && B"), not the stored `{id}` form.
const letteredExpression = computed(() =>
  tokens.value
    .map((token) =>
      token.kind === "operand" ? (letterById.value.get(token.id) ?? "?") : token.text,
    )
    .join(" "),
);

const readable = (child: CompositeAlertChild): child is CompositeAlertReadableChild =>
  child.accessible;

const levelFor = (id: string): string => {
  const preview = previewChildById.value.get(id);
  const selected = childById.value.get(id);
  const level =
    (preview && readable(preview) ? preview.level : undefined) ?? selected?.level ?? null;
  return level || "nodata";
};

const truthFor = (id: string): boolean | undefined => {
  const child = previewChildById.value.get(id);
  return child && readable(child) ? child.truth : undefined;
};

const nameFor = (id: string): ReturnType<typeof raw> => raw(childById.value.get(id)?.name ?? id);

// Stale children — the one exception the server warnings don't already surface.
// Shown as a compact banner instead of the old wide table.
const staleChildren = computed(() =>
  rows.value.filter(
    (child): child is CompositeAlertReadableChild =>
      readable(child) && !!child.stale && child.policy_decision === "used_last_state",
  ),
);

const resultLabel = computed(() => {
  if (!value.value.valid) return t("alerts.composite.invalid");
  if (value.value.result === true) return t("alerts.composite.wouldTrigger");
  if (value.value.result === false) return t("alerts.composite.wouldNotTrigger");
  return t("alerts.composite.unknownResult");
});

const warningText = (code: string) => {
  const known: Record<string, ReturnType<typeof t>> = {
    child_disabled: t("alerts.composite.warningChildDisabled"),
    child_never_evaluated: t("alerts.composite.warningChildNeverEvaluated"),
    child_stale: t("alerts.composite.warningChildStale"),
  };
  return known[code] ?? raw(code);
};
</script>

<template>
  <section class="flex min-h-0 flex-col gap-3" data-test="alerts-composite-preview">
    <!-- Verdict + live evaluation -->
    <div
      class="border-border-default bg-surface-subtle rounded-surface flex flex-wrap items-center gap-3 border p-4"
      data-test="alerts-composite-preview-result"
      aria-live="polite"
    >
      <span class="text-text-secondary text-sm">{{ t("alerts.composite.previewResult") }}</span>
      <OTag
        :variant="
          preview.valid && preview.result
            ? 'success-soft'
            : preview.valid
              ? 'default-soft'
              : 'error-soft'
        "
        :icon="preview.valid && preview.result ? 'check-circle' : 'cancel'"
        size="sm"
        :label="resultLabel"
      />

      <template v-if="operandTokens.length">
        <span class="bg-border-default h-4 w-px" />
        <span class="font-mono text-base leading-none">
          <template v-for="(token, index) in tokens" :key="index">
            <OTag
              v-if="token.kind === 'operand'"
              type="alertLevel"
              :value="levelFor(token.id)"
              :label="raw(letterById.get(token.id) ?? '?')"
              size="xs"
            />
            <span v-else class="text-text-secondary mx-1 font-semibold">{{ raw(token.text) }}</span>
          </template>
          <span class="text-text-secondary mx-1 font-semibold">{{ raw("→") }}</span>
          <OTag
            :variant="preview.result ? 'error-soft' : 'success-soft'"
            :label="preview.result ? t('alerts.composite.firing') : t('alerts.composite.normal')"
            size="xs"
          />
        </span>
      </template>
    </div>

    <!-- Step-by-step -->
    <div
      v-if="operandTokens.length"
      class="border-border-default rounded-surface border p-4"
      data-test="alerts-composite-preview-steps"
    >
      <div class="text-text-secondary mb-2 text-xs">{{ t("alerts.composite.stepByStep") }}</div>
      <ol class="relative flex flex-col gap-3">
        <!-- Vertical rail behind the step dots. -->
        <span
          aria-hidden="true"
          class="bg-border-default absolute top-1 bottom-1 left-2 w-0.5 rounded-full"
        />

        <li v-for="token in operandTokens" :key="token.id" class="relative pl-7">
          <span
            aria-hidden="true"
            class="absolute top-1 left-0.5 h-3.5 w-3.5 rounded-full"
            :class="truthFor(token.id) ? 'bg-error-500' : 'bg-success-500'"
          />
          <div class="flex flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-2 text-xs">
              <span class="text-theme-accent font-bold">{{
                raw(letterById.get(token.id) ?? "?")
              }}</span>
              <span class="text-text-heading min-w-0 truncate">{{ nameFor(token.id) }}</span>
            </span>
            <span class="text-text-secondary flex items-center gap-1.5 text-xs">
              <OTag type="alertLevel" :value="levelFor(token.id)" size="xs" />
              <span>{{ raw("→") }}</span>
              <span class="text-text-heading font-mono font-semibold">
                {{ raw(String(!!truthFor(token.id))) }}
              </span>
            </span>
          </div>
        </li>

        <li class="relative pl-7">
          <span
            aria-hidden="true"
            class="absolute top-1 left-0.5 h-3.5 w-3.5 rounded-full"
            :class="preview.result ? 'bg-error-500' : 'bg-success-500'"
          />
          <div class="flex flex-col gap-0.5">
            <span class="text-text-heading text-xs font-semibold">{{
              t("alerts.composite.result")
            }}</span>
            <span class="text-text-secondary flex items-center gap-1.5 text-xs">
              <span class="font-mono">{{ raw(letteredExpression) }}</span>
              <span>{{ raw("→") }}</span>
              <OTag
                :variant="preview.result ? 'error-soft' : 'success-soft'"
                :label="
                  preview.result
                    ? t('alerts.composite.trueResult')
                    : t('alerts.composite.falseResult')
                "
                size="xs"
              />
            </span>
          </div>
        </li>
      </ol>
    </div>

    <OBanner
      v-for="warning in value.warnings"
      :key="`${warning.code}-${warning.child_alert_id ?? ''}`"
      variant="warning"
      dense
      :data-test="`alerts-composite-preview-warning-${warning.code}`"
      :content="warningText(warning.code)"
    />
    <OBanner
      v-for="child in staleChildren"
      :key="`stale-${child.alert_id}`"
      variant="warning"
      dense
      :data-test="`alerts-composite-preview-stale-${child.alert_id}`"
      :content="
        t('alerts.composite.warningChildStaleNamed', {
          name: child.name,
          level: child.level ?? raw('—'),
        })
      "
    />
    <OBanner
      v-for="error in value.errors"
      :key="`${error.code}-${error.child_alert_id ?? ''}`"
      variant="error-soft"
      dense
      :data-test="`alerts-composite-preview-error-${error.code}`"
      :content="error.message ? raw(error.message) : raw(error.code)"
    />
  </section>
</template>
