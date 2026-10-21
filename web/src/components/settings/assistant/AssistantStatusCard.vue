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
    v-if="view.kind === 'setup'"
    class="flex flex-col gap-4"
    data-test="settings-assistant-setup-card"
  >
    <AssistantGateState reason="not_configured" size="inline" is-admin />
    <div class="flex flex-col gap-2">
      <AssistantEnvValue
        v-for="row in SETUP_ENV"
        :key="row.envName"
        :label="t(row.labelKey)"
        :value="row.envName === 'O2_AI_ENABLED' ? raw(String(config.aiEnabled)) : null"
        :env-name="row.envName"
      />
    </div>
  </div>
  <OCard
    v-else
    variant="outlined"
    class="flex flex-col gap-4 p-4"
    :data-test="
      view.kind === 'member_setup'
        ? 'settings-assistant-setup-card'
        : 'settings-assistant-status-card'
    "
    :data-state="view.kind"
  >
    <template v-if="view.kind === 'loading'">
      <OSkeleton type="rect" class="h-6 w-32" />
      <OSkeleton v-for="n in 4" :key="n" type="text" class="w-3/4" />
    </template>
    <OEmptyState
      v-else-if="view.kind === 'error'"
      preset="load-error"
      size="block"
      data-test="settings-assistant-status-error"
      @action="emit('retry')"
    />
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <OTag :variant="view.tone" :label="view.chip" data-test="settings-assistant-status-chip" />
      </div>
      <p v-if="view.body" class="text-text-body text-sm" data-test="settings-assistant-status-body">
        {{ view.body }}
      </p>
      <dl
        v-if="rows.length"
        class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm max-md:grid-cols-1 max-md:gap-y-0.5"
      >
        <template v-for="row in rows" :key="row.id">
          <dt class="text-text-secondary max-md:mt-1.5">{{ row.label }}</dt>
          <dd
            class="text-text-body min-w-0 wrap-break-word"
            :data-test="`settings-assistant-status-${row.id}`"
          >
            <OTimeCell v-if="row.time !== undefined" :value="row.time" />
            <template v-else>{{ row.value }}</template>
          </dd>
        </template>
      </dl>
      <div v-if="view.kind === 'off'" class="flex flex-wrap gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :class="TOUCH_TARGET_CLASS"
          data-test="settings-assistant-open-access"
          @click="emit('open-access')"
          >{{ t("assistant.settings.status.openAccess") }}</OButton
        >
      </div>
      <div v-if="canTest" class="flex justify-end max-md:flex-col">
        <OButton
          variant="outline"
          size="sm-action"
          class="max-md:min-h-11 max-md:w-full"
          :loading="running"
          :disabled="running"
          focusable-unavailable
          data-test="settings-assistant-test-btn"
          @click="emit('test')"
          >{{
            running ? t("assistant.settings.test.running") : t("assistant.settings.test.button")
          }}</OButton
        >
      </div>
    </template>
    <p role="status" class="sr-only" data-test="settings-assistant-test-announce">
      {{ announcement }}
    </p>
  </OCard>
</template>

<script lang="ts">
import type { DataSharingLevel } from "@/services/assistant_settings";
import type { AssistantCapabilitiesResponse } from "@/services/assistant";
import type { I18nKey, I18nText } from "@/types/i18n";

export type AssistantTestState =
  "idle" | "running" | { ok: boolean; durationMs?: number; cause?: I18nText; at: number };

export interface AssistantStatusCardProps {
  capabilities: AssistantCapabilitiesResponse | null;
  status: "loading" | "ready" | "error" | "unsupported";
  config: {
    aiEnabled: boolean;
    orgEnabled?: boolean;
    orgEnabledBy?: { actor: string; at: number };
  };
  isAdmin: boolean;
  lastClientError?: { code: string; at: number };
  testState: AssistantTestState;
  /** The org's data-sharing level; absent until org settings exist, which shares raw rows. */
  dataLevel?: DataSharingLevel;
}

export interface AssistantStatusCardEmits {
  (e: "test"): void;
  (e: "retry"): void;
  (e: "open-access"): void;
}

export const DATA_LEVEL_LABEL: Record<DataSharingLevel, I18nKey> = {
  schema: "assistant.settings.data.levelSchema",
  aggregates: "assistant.settings.data.levelAggregates",
  raw: "assistant.settings.data.levelRaw",
};

/** Microseconds, milliseconds or seconds since the epoch, read by magnitude. */
export function epochMs(ts: number): number {
  if (ts > 1e14) return Math.floor(ts / 1000);
  if (ts > 1e11) return ts;
  return ts * 1000;
}

const SETUP_ENV: { envName: string; labelKey: I18nKey }[] = [
  { envName: "O2_AI_ENABLED", labelKey: "assistant.settings.status.agentEnabled" },
  { envName: "O2_AGENT_URL", labelKey: "assistant.settings.status.agentUrl" },
  { envName: "O2_AI_HA_ENABLED", labelKey: "assistant.settings.status.agentHa" },
];
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { parseCapabilityStatus } from "@/services/assistant_settings";
import { formatRelative, uiIntlLocale } from "@/utils/formatters";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantEnvValue from "./AssistantEnvValue.vue";

interface StatusView {
  kind: "setup" | "member_setup" | "off" | "loading" | "error" | "unsupported" | "down" | "ok";
  chip: I18nText;
  tone: BadgeVariant;
  body: I18nText | null;
}

interface StatusRow {
  id: string;
  label: I18nText;
  value?: I18nText;
  time?: number;
}

const props = withDefaults(defineProps<AssistantStatusCardProps>(), {
  lastClientError: undefined,
  dataLevel: undefined,
});
const emit = defineEmits<AssistantStatusCardEmits>();

const { t } = useI18nTyped();

const running = computed(() => props.testState === "running");
const result = computed(() => (typeof props.testState === "object" ? props.testState : null));

const caps = computed(() => parseCapabilityStatus(props.capabilities));
const healthy = computed(() => caps.value?.health?.status === "ok");
const announcement = ref("");

const view = computed<StatusView>(() => {
  const plain = (kind: StatusView["kind"], chip: I18nText, body: I18nText | null = null) => ({
    kind,
    chip,
    tone: "default-soft" as BadgeVariant,
    body,
  });
  if (!props.config.aiEnabled) {
    if (props.isAdmin) return plain("setup", t("assistant.settings.status.notSetUp"));
    return plain(
      "member_setup",
      t("assistant.settings.status.notSetUp"),
      t("assistant.settings.status.notSetUpMember"),
    );
  }
  if (props.config.orgEnabled === false)
    return plain("off", t("assistant.settings.status.offForOrg"), offBody());
  if (props.status === "loading") return plain("loading", raw(""));
  if (props.status === "error") return plain("error", raw(""));
  // A capabilities answer without a health probe says nothing about reachability.
  if (props.status === "unsupported" || !caps.value?.health) {
    return plain(
      "unsupported",
      t("assistant.settings.status.configured"),
      t("assistant.settings.status.healthUnsupported"),
    );
  }
  if (!healthy.value) {
    return {
      kind: "down",
      chip: t("assistant.settings.status.unreachable"),
      tone: "error-soft",
      body: t("assistant.settings.status.unreachableBody"),
    };
  }
  return {
    kind: "ok",
    chip: t("assistant.settings.status.reachable"),
    tone: "success-soft",
    body: null,
  };
});

const canTest = computed(
  () => props.isAdmin && (view.value.kind === "ok" || view.value.kind === "down"),
);

const rows = computed<StatusRow[]>(() => {
  const kind = view.value.kind;
  const dataShared: StatusRow = {
    id: "data-shared",
    label: t("assistant.settings.status.dataShared"),
    value: t(DATA_LEVEL_LABEL[props.dataLevel ?? "raw"]),
  };
  if (kind === "off") return [dataShared];
  if (kind !== "ok" && kind !== "down" && kind !== "unsupported") return [];
  const health = caps.value?.health;
  const list: StatusRow[] = [];
  if (kind === "ok") {
    list.push({ id: "model", label: t("assistant.settings.status.model"), value: modelText() });
    list.push({
      id: "agent-version",
      label: t("assistant.settings.status.agentVersion"),
      value: raw(caps.value?.agentVersion || "—"),
    });
  }
  list.push({
    id: "last-error",
    label: t("assistant.settings.status.lastError"),
    value: lastErrorText(),
  });
  if (kind !== "unsupported" && health?.checkedAt) {
    list.push({
      id: "checked",
      label: t("assistant.settings.status.checked"),
      time: epochMs(health.checkedAt),
    });
  }
  list.push(dataShared);
  if (result.value) {
    list.push({
      id: "last-test",
      label: t("assistant.settings.test.lastTest"),
      value: testRow(result.value),
    });
  }
  return list;
});

// Clearing first makes a live region announce a second identical result too.
watch(result, async (r) => {
  announcement.value = "";
  if (!r) return;
  await nextTick();
  announcement.value = r.ok
    ? t("assistant.settings.test.passed", { duration: raw(duration(r.durationMs)) })
    : t("assistant.settings.test.failed", { cause: causeOf(r.cause) });
});

function modelText(): I18nText {
  const model = caps.value?.model;
  if (model) return raw(model);
  return props.isAdmin ? raw("—") : t("assistant.settings.status.modelHidden");
}

function lastErrorText(): I18nText {
  const health = caps.value?.health;
  if (view.value.kind === "down" && health?.lastError) {
    const when = health.checkedAt ? ` · ${formatRelative(epochMs(health.checkedAt))}` : "";
    return raw(`${health.lastError}${when}`);
  }
  if (view.value.kind === "unsupported" && props.lastClientError) {
    return t("assistant.settings.status.clientError");
  }
  return t("assistant.settings.status.lastErrorNone");
}

function offBody(): I18nText {
  const by = props.config.orgEnabledBy;
  if (!by) return t("assistant.settings.status.offBodyUnknown");
  const date = new Intl.DateTimeFormat(uiIntlLocale(), { dateStyle: "medium" }).format(
    epochMs(by.at),
  );
  return t("assistant.settings.status.offBody", { actor: raw(by.actor), date: raw(date) });
}

function testRow(r: { ok: boolean; durationMs?: number; cause?: I18nText; at: number }): I18nText {
  const when = raw(formatRelative(r.at));
  if (r.ok)
    return t("assistant.settings.test.passedRow", { duration: raw(duration(r.durationMs)), when });
  return t("assistant.settings.test.failedRow", { cause: causeOf(r.cause), when });
}

function causeOf(cause: I18nText | undefined): I18nText {
  return cause ?? t("assistant.settings.test.unknownCause");
}

function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = new Intl.NumberFormat(uiIntlLocale(), { maximumFractionDigits: 1 }).format(
    ms / 1000,
  );
  return `${seconds} s`;
}
</script>
