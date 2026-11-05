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

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { DataHealthCheck } from "@/services/gen-ai-data-health.service";
import { formatTokens } from "@/utils/llmUtils";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { fixTarget, type TimeWindow } from "./llmDataTrust.utils";
import { useDataHealthText } from "./composables/useDataHealthText";

const props = defineProps<{
  check: DataHealthCheck;
  stream: string;
  /** The window `check` covers; the fix links open the same window. */
  checkedWindow?: TimeWindow | null;
  /** Sample trace ids for this check, when loaded. */
  samples?: string[];
  focused?: boolean;
}>();

const emit = defineEmits<{
  "view-trace": [traceId: string];
  /** The fix opens a page in this tab. */
  leave: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { label, detail, truncatedNote, fixLabel, statusLabel } = useDataHealthText();

// OSS locks Model Pricing and GenAI Agent Mapping, so those checks offer no fix there.
const target = computed(() => {
  const to = fixTarget(
    props.check.id,
    props.stream,
    store.state.selectedOrganization?.identifier ?? "",
    props.checkedWindow,
  );
  const locked =
    to.kind === "route" &&
    !checkFeatureAccess(to.feature, buildFeatureGateContext(store.state.zoConfig)).allowed;
  return locked ? null : to;
});

const badgeVariant = computed(() => {
  if (props.check.status === "error") return "error-soft" as const;
  if (props.check.status === "warning") return "warning-soft" as const;
  return "success-soft" as const;
});

function openFix() {
  const to = target.value;
  if (!to) return;
  if (to.kind === "route") {
    emit("leave");
    router.push(to.to);
  } else {
    window.open(to.href, "_blank", "noopener,noreferrer");
  }
}

/** For users who cannot open the setting themselves: a link an admin can follow. */
async function copyFixLink() {
  const to = target.value;
  if (!to) return;
  const href =
    to.kind === "route"
      ? new URL(router.resolve(to.to).href, window.location.origin).toString()
      : to.href;
  try {
    await navigator.clipboard.writeText(href);
    toast({ variant: "success", message: t("llmDataTrust.health.linkCopied") });
  } catch (e) {
    console.error("Copy fix link failed:", e);
  }
}

function shortTraceId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
</script>

<template>
  <div
    class="rounded-default border-border-default flex flex-col gap-1.5 border p-3"
    :class="{ 'ring-accent ring-1': focused }"
    :data-test="`llm-data-health-card-${check.id}`"
    :data-status="check.status"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-heading text-sm font-semibold">{{ label(check.id) }}</span>
      <OBadge :variant="badgeVariant" size="sm">{{ statusLabel(check.status) }}</OBadge>
    </div>
    <span class="text-text-secondary text-xs" :data-test="`llm-data-health-detail-${check.id}`">{{
      detail(check)
    }}</span>
    <div v-if="check.id === 'unpriced_models' && check.models?.length" class="flex flex-wrap gap-1">
      <OBadge v-for="m in check.models" :key="m.model ?? ''" variant="default-outline" size="sm">{{
        raw(`${m.model ?? t("llmDataTrust.noModelName")} · ${formatTokens(m.tokens)}`)
      }}</OBadge>
      <span
        v-if="truncatedNote(check)"
        class="text-2xs text-text-secondary self-center"
        data-test="llm-data-health-unpriced-truncated"
        >{{ truncatedNote(check) }}</span
      >
    </div>
    <div
      v-if="check.status !== 'pass' && samples?.length"
      class="text-2xs text-text-secondary flex flex-wrap items-center gap-1.5"
    >
      <span>{{ t("llmDataTrust.health.samples") }}</span>
      <button
        v-for="id in samples"
        :key="id"
        type="button"
        class="text-text-link hover:text-text-link-hover font-mono underline"
        :data-test="`llm-data-health-sample-${check.id}`"
        @click="emit('view-trace', id)"
      >
        {{ raw(shortTraceId(id)) }}
      </button>
    </div>
    <div v-if="check.status !== 'pass' && target" class="flex flex-wrap items-center gap-2 pt-1">
      <OButton
        variant="primary"
        size="xs"
        :data-test="`llm-data-health-fix-${check.id}`"
        @click="openFix"
        >{{ fixLabel(check.id) }}</OButton
      >
      <OButton
        v-if="target.kind === 'route'"
        variant="ghost-muted"
        size="xs"
        @click="copyFixLink"
        >{{ t("llmDataTrust.health.copyLink") }}</OButton
      >
    </div>
  </div>
</template>
