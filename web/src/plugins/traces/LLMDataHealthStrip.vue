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

<!-- AI data health strip on LLM Insights: one chip per failing check with its
     count for the current scope and window, and a drawer whose cards link each
     problem to the setting or guide that fixes it. Hidden when every check passes. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatDistanceToNowStrict } from "date-fns";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type {
  DataHealthCheck,
  DataHealthCheckId,
  DataHealthResponse,
} from "@/services/gen-ai-data-health.service";
import { fixTarget, healthCounts, sortChecks, unpricedTotals } from "./llmDataTrust.utils";
import type { DataHealthSamples } from "./composables/useLLMDataHealth";
import { formatTokens } from "@/utils/llmUtils";

const props = defineProps<{
  health: DataHealthResponse | null;
  loading?: boolean;
  error?: boolean;
  stream: string;
  /** Sample trace ids per check; null until loaded. */
  samples: DataHealthSamples | null;
  samplesLoading?: boolean;
}>();

const emit = defineEmits<{
  rerun: [];
  "load-samples": [];
  "view-trace": [traceId: string];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const drawerOpen = ref(false);
const focusedCheck = ref<DataHealthCheckId | null>(null);

// With model pricing off (ZO_MODEL_PRICING_ENABLED=false) nothing is priced and
// Model Pricing is hidden in Settings, so there is no unpriced check to show or fix.
const pricingEnabled = computed(() => !!store.state.zoConfig?.model_pricing_enabled);
const checks = computed(() =>
  sortChecks(
    (props.health?.checks ?? []).filter((c) => c.id !== "unpriced_models" || pricingEnabled.value),
  ),
);
const counts = computed(() => healthCounts(checks.value));
// Passing checks fold into the "N passing" link; the drawer lists them all.
const failing = computed(() => checks.value.filter((c) => c.status !== "pass"));
const visible = computed(() => !!props.health && counts.value.errors + counts.value.warnings > 0);
const checkedAgo = computed(() =>
  props.health?.checked_at
    ? formatDistanceToNowStrict(new Date(props.health.checked_at / 1000), { addSuffix: true })
    : "",
);

function pct(check: DataHealthCheck): string {
  if (!check.total) return "0%";
  const p = (check.affected / check.total) * 100;
  return `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

const LABELS: Record<DataHealthCheckId, I18nText> = {
  unpriced_models: t("llmDataTrust.health.checks.unpriced_models.label"),
  missing_agent_identity: t("llmDataTrust.health.checks.missing_agent_identity.label"),
  zero_duration_spans: t("llmDataTrust.health.checks.zero_duration_spans.label"),
  missing_session_id: t("llmDataTrust.health.checks.missing_session_id.label"),
};

/** The count a chip shows: models for pricing, share for identity/session, spans otherwise. */
function chipCount(check: DataHealthCheck): string {
  switch (check.id) {
    case "unpriced_models":
      return String(unpricedTotals(check).modelCount || check.affected);
    case "missing_agent_identity":
    case "missing_session_id":
      return pct(check);
    default:
      return check.affected.toLocaleString();
  }
}

function detail(check: DataHealthCheck): I18nText {
  if (check.status === "pass") {
    switch (check.id) {
      case "unpriced_models":
        return t("llmDataTrust.health.checks.unpriced_models.pass");
      case "missing_agent_identity":
        return t("llmDataTrust.health.checks.missing_agent_identity.pass");
      case "zero_duration_spans":
        return t("llmDataTrust.health.checks.zero_duration_spans.pass");
      case "missing_session_id":
        return t("llmDataTrust.health.checks.missing_session_id.pass");
    }
  }
  const params = {
    affected: check.affected.toLocaleString(),
    total: check.total.toLocaleString(),
    pct: pct(check),
  };
  switch (check.id) {
    case "unpriced_models": {
      const { modelCount, tokens } = unpricedTotals(check);
      return t(
        "llmDataTrust.health.checks.unpriced_models.detail",
        {
          count: modelCount.toLocaleString(),
          spans: check.affected.toLocaleString(),
          tokens: formatTokens(tokens),
        },
        modelCount,
      );
    }
    case "missing_agent_identity":
      return t("llmDataTrust.health.checks.missing_agent_identity.detail", params);
    case "zero_duration_spans":
      return t("llmDataTrust.health.checks.zero_duration_spans.detail", params);
    case "missing_session_id":
      return t("llmDataTrust.health.checks.missing_session_id.detail", params);
  }
}

/** "Top 20 of 25 by tokens" when the server lists only part of the unpriced models. */
function truncatedNote(check: DataHealthCheck): I18nText | null {
  const { truncated, models, modelCount } = unpricedTotals(check);
  if (!truncated) return null;
  return t("llmDataTrust.health.checks.unpriced_models.truncated", {
    shown: models.length,
    total: modelCount.toLocaleString(),
  });
}

function fixLabel(id: DataHealthCheckId): I18nText {
  switch (id) {
    case "unpriced_models":
      return t("llmDataTrust.health.checks.unpriced_models.fix");
    case "missing_agent_identity":
      return t("llmDataTrust.health.checks.missing_agent_identity.fix");
    case "zero_duration_spans":
      return t("llmDataTrust.health.checks.zero_duration_spans.fix");
    case "missing_session_id":
      return t("llmDataTrust.health.checks.missing_session_id.fix");
  }
}

function statusVariant(status: DataHealthCheck["status"]) {
  if (status === "error") return "error-soft" as const;
  if (status === "warning") return "warning-soft" as const;
  return "success-soft" as const;
}

function statusLabel(status: DataHealthCheck["status"]): I18nText {
  if (status === "error") return t("llmDataTrust.health.status.error");
  if (status === "warning") return t("llmDataTrust.health.status.warning");
  return t("llmDataTrust.health.status.pass");
}

function orgId(): string {
  return store.state.selectedOrganization?.identifier ?? "";
}

function openFix(id: DataHealthCheckId) {
  const target = fixTarget(id, props.stream, orgId());
  if (target.kind === "route") {
    drawerOpen.value = false;
    router.push(target.to);
  } else {
    window.open(target.href, "_blank", "noopener,noreferrer");
  }
}

/** For users who cannot open the setting themselves: a link an admin can follow. */
async function copyFixLink(id: DataHealthCheckId) {
  const target = fixTarget(id, props.stream, orgId());
  const href =
    target.kind === "route"
      ? new URL(router.resolve(target.to).href, window.location.origin).toString()
      : target.href;
  try {
    await navigator.clipboard.writeText(href);
    toast({ variant: "success", message: t("llmDataTrust.health.linkCopied") });
  } catch (e) {
    console.error("Copy fix link failed:", e);
  }
}

function openDrawer(id: DataHealthCheckId | null) {
  focusedCheck.value = id;
  drawerOpen.value = true;
}

// Samples cost a query per failing check, so they load only while the drawer
// is open; a new scope or a re-run clears them and they load again.
watch(
  () => drawerOpen.value && props.samples === null && !props.samplesLoading,
  (needed) => {
    if (needed) emit("load-samples");
  },
);

function shortTraceId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function viewTrace(traceId: string) {
  drawerOpen.value = false;
  emit("view-trace", traceId);
}
</script>

<template>
  <div
    v-if="error && !health"
    class="text-2xs text-text-secondary mt-2.5 flex items-center gap-2"
    data-test="llm-data-health-error"
  >
    <OIcon name="error" size="xs" />
    <span>{{ t("llmDataTrust.health.loadError") }}</span>
    <OButton variant="ghost-primary" size="xs" @click="emit('rerun')">{{
      t("llmDataTrust.health.rerun")
    }}</OButton>
  </div>
  <div
    v-else-if="visible"
    class="bg-card-glass-bg rounded-default border-border-default mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 text-xs"
    data-test="llm-data-health-strip"
  >
    <span class="text-text-heading inline-flex items-center gap-1.5 font-semibold">
      <OIcon name="monitor-heart" size="sm" />
      {{ t("llmDataTrust.health.title") }}
    </span>
    <!-- The icon carries the status, so it reads without the colour. -->
    <button
      v-for="check in failing"
      :key="check.id"
      type="button"
      class="rounded-default border-border-default hover:bg-surface-subtle inline-flex items-center gap-1 border px-2 py-0.5"
      :class="check.status === 'error' ? 'text-status-error-text' : 'text-status-warning-text'"
      :data-test="`llm-data-health-chip-${check.id}`"
      @click="openDrawer(check.id)"
    >
      <OIcon :name="check.status === 'error' ? 'error' : 'warning-amber'" size="xs" />
      {{ LABELS[check.id] }} · {{ raw(chipCount(check)) }}
    </button>
    <button
      v-if="counts.passing"
      type="button"
      class="text-text-secondary hover:text-text-heading inline-flex items-center"
      data-test="llm-data-health-passing"
      @click="openDrawer(null)"
    >
      {{ t("llmDataTrust.health.passing", { n: counts.passing }) }}
      <OIcon name="chevron-right" size="xs" />
    </button>
    <span v-if="checkedAgo" class="text-text-secondary ms-auto">{{
      t("llmDataTrust.health.checkedAgo", { ago: checkedAgo })
    }}</span>
  </div>

  <ODrawer
    v-model:open="drawerOpen"
    size="md"
    :title="t('llmDataTrust.health.drawerTitle')"
    :sub-title="t('llmDataTrust.health.drawerSubtitle', { stream })"
    :primary-button-label="t('llmDataTrust.health.rerun')"
    :primary-button-loading="loading"
    primary-button-data-test="llm-data-health-rerun"
    :secondary-button-label="t('llmDataTrust.health.close')"
    @click:primary="emit('rerun')"
    @click:secondary="drawerOpen = false"
  >
    <div class="flex flex-col gap-2.5 p-3" data-test="llm-data-health-drawer">
      <div
        v-for="check in checks"
        :key="check.id"
        class="rounded-default border-border-default flex flex-col gap-1.5 border p-3"
        :class="{ 'ring-accent ring-1': focusedCheck === check.id }"
        :data-test="`llm-data-health-card-${check.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-text-heading text-sm font-semibold">{{ LABELS[check.id] }}</span>
          <OBadge :variant="statusVariant(check.status)" size="sm">{{
            statusLabel(check.status)
          }}</OBadge>
        </div>
        <span class="text-text-secondary text-xs">{{ detail(check) }}</span>
        <div
          v-if="check.id === 'unpriced_models' && check.models?.length"
          class="flex flex-wrap gap-1"
        >
          <OBadge
            v-for="m in check.models"
            :key="m.model ?? ''"
            variant="default-outline"
            size="sm"
            >{{
              raw(`${m.model ?? t("llmDataTrust.noModelName")} · ${formatTokens(m.tokens)}`)
            }}</OBadge
          >
          <span
            v-if="truncatedNote(check)"
            class="text-2xs text-text-secondary self-center"
            data-test="llm-data-health-unpriced-truncated"
            >{{ truncatedNote(check) }}</span
          >
        </div>
        <div
          v-if="check.status !== 'pass' && samples?.[check.id]?.length"
          class="text-2xs text-text-secondary flex flex-wrap items-center gap-1.5"
        >
          <span>{{ t("llmDataTrust.health.samples") }}</span>
          <button
            v-for="id in samples?.[check.id]"
            :key="id"
            type="button"
            class="text-text-link hover:text-text-link-hover font-mono underline"
            :data-test="`llm-data-health-sample-${check.id}`"
            @click="viewTrace(id)"
          >
            {{ raw(shortTraceId(id)) }}
          </button>
        </div>
        <div v-if="check.status !== 'pass'" class="flex flex-wrap items-center gap-2 pt-1">
          <OButton
            variant="primary"
            size="xs"
            :data-test="`llm-data-health-fix-${check.id}`"
            @click="openFix(check.id)"
            >{{ fixLabel(check.id) }}</OButton
          >
          <OButton
            v-if="fixTarget(check.id, stream, orgId()).kind === 'route'"
            variant="ghost-muted"
            size="xs"
            @click="copyFixLink(check.id)"
            >{{ t("llmDataTrust.health.copyLink") }}</OButton
          >
        </div>
      </div>
    </div>
  </ODrawer>
</template>
