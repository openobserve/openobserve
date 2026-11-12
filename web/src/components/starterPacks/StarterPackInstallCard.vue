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
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

export type StarterPackCardStatus =
  "checking" | "waiting" | "ready" | "running" | "failed" | "interrupted" | "forbidden";

const props = withDefaults(
  defineProps<{
    flow: StarterPackFlow;
    title: I18nText;
    streamCount: number;
    testId: string;
    primaryLabel?: I18nText;
    primaryTestId?: string;
    dismissible?: boolean;
    status?: StarterPackCardStatus;
  }>(),
  { status: "ready" },
);
const emit = defineEmits<{ install: []; details: []; dismiss: [] }>();

const { t } = useI18nTyped();

const dashboards = computed(() => props.flow.dashboardCount.value);
const alerts = computed(() => props.flow.alertCount.value);
const views = computed(() => props.flow.viewCount.value);
const total = computed(() => dashboards.value + alerts.value + views.value);
const made = computed(() => props.flow.made.value.length);
const planned = computed(() => props.flow.toCreate.value.length);
const busy = computed(() => props.status === "checking" || props.status === "running");

const heading = computed(() => {
  const counts = { made: made.value, total: planned.value };
  switch (props.status) {
    case "checking":
      return t("starterPacks.guide.checkingTitle");
    case "waiting":
      return t("starterPacks.guide.stillWaitingTitle");
    case "running":
      return t("starterPacks.guide.settingUpTitle", counts);
    case "failed":
      return t("starterPacks.guide.failedTitle", {
        ...counts,
        failed: props.flow.failed.value.length,
      });
    case "interrupted":
      return t("starterPacks.guide.interruptedTitle", counts);
    case "forbidden":
      return t("starterPacks.guide.forbiddenTitle");
    default:
      return t("starterPacks.home.title", { title: props.title });
  }
});
const sub = computed(() => {
  switch (props.status) {
    case "checking":
      return t("starterPacks.guide.checkingSub");
    case "waiting":
      return t("starterPacks.guide.stillWaitingSub");
    case "running":
    case "failed":
      return t("starterPacks.guide.settingUpSub");
    case "interrupted":
      return t("starterPacks.guide.interruptedSub", { made: made.value });
    case "forbidden":
      return t("starterPacks.guide.forbiddenSub", { title: props.title });
    default:
      return t("starterPacks.guide.readySub");
  }
});
const headIcon = computed(() => {
  if (props.status === "interrupted") return "pause-circle-filled";
  if (props.status === "forbidden") return "lock";
  return "hub";
});
const primaryText = computed(() => {
  if (props.status === "checking") return t("starterPacks.guide.checkingBtn");
  if (props.status === "running") return t("starterPacks.guide.settingUpBtn");
  return props.primaryLabel ?? t("starterPacks.card.install", { count: total.value }, total.value);
});

const STATE_ICONS = {
  created: { name: "check-circle", tone: "text-status-positive" },
  waiting: { name: "schedule", tone: "text-text-muted" },
  failed: { name: "error", tone: "text-status-error-text" },
  paused: { name: "pause-circle-filled", tone: "text-text-muted" },
};
// Null = no status icon; "spinner" = still creating.
const rowIcon = (kind: PackItemKind) => {
  if (!["running", "failed", "interrupted"].includes(props.status)) return null;
  const items = props.flow.toCreate.value.filter((item) => item.kind === kind);
  if (!items.length) return null;
  if (items.some(({ status }) => status === "failed")) return STATE_ICONS.failed;
  if (items.every(({ status }) => status === "created")) return STATE_ICONS.created;
  if (props.status === "interrupted") return STATE_ICONS.paused;
  return props.flow.running.value ? ("spinner" as const) : STATE_ICONS.waiting;
};
const rows = computed(() => [
  {
    kind: "dashboard" as const,
    state: rowIcon("dashboard"),
    icon: "dashboard",
    label: t("starterPacks.card.dashboards", { count: dashboards.value }, dashboards.value),
    meta: t("starterPacks.guide.rowDashboardMeta", {
      folder: raw(props.flow.pack.folder.name),
    }),
  },
  {
    kind: "alert" as const,
    state: rowIcon("alert"),
    icon: "notifications-paused",
    label: t("starterPacks.countAlerts", { count: alerts.value }, alerts.value),
    meta: t("starterPacks.guide.rowAlertsSilent"),
  },
  {
    kind: "savedView" as const,
    state: rowIcon("savedView"),
    icon: "bookmark",
    label: t("starterPacks.guide.rowSavedViews", { count: views.value }, views.value),
    meta: t("starterPacks.guide.rowSavedViewsMeta"),
  },
]);
</script>

<template>
  <OCard
    variant="outlined"
    class="bg-surface-panel gap-3 p-4 text-sm"
    :data-test="testId"
    :data-status="status"
  >
    <div class="flex items-start gap-3">
      <OIcon :name="headIcon" size="md" class="text-text-secondary mt-0.5 shrink-0" />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <OText variant="section" class="text-text-heading" :data-test="`${testId}-title`">{{
          heading
        }}</OText>
        <OText variant="meta" :data-test="`${testId}-sub`"
          >{{
            status === "ready" && streamCount
              ? t("starterPacks.card.matched", { count: streamCount }, streamCount)
              : ""
          }}
          {{ sub }}</OText
        >
        <OText v-if="status === 'ready'" variant="meta" :data-test="`${testId}-removable`">{{
          t("starterPacks.card.removable")
        }}</OText>
        <OText v-if="flow.preview.value?.offline" variant="meta" :data-test="`${testId}-offline`">{{
          t("starterPacks.offline")
        }}</OText>
      </div>
      <OButton
        v-if="dismissible"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('starterPacks.card.close')"
        :data-test="`${testId}-dismiss-btn`"
        @click="emit('dismiss')"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <ul
      v-if="status !== 'checking' && status !== 'forbidden'"
      class="flex flex-col gap-2"
      :data-test="`${testId}-counts`"
    >
      <li
        v-for="row in rows"
        :key="row.kind"
        class="flex items-start gap-3"
        :data-test="`${testId}-row-${row.kind}`"
      >
        <OIcon :name="row.icon" size="md" class="text-text-secondary shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col">
          <strong class="text-text-heading">{{ row.label }}</strong>
          <OText variant="meta">{{ row.meta }}</OText>
        </div>
        <OSpinner v-if="row.state === 'spinner'" size="xs" class="shrink-0" />
        <OIcon
          v-else-if="row.state"
          :name="row.state.name"
          size="sm"
          :class="['shrink-0', row.state.tone]"
          :data-test="`${testId}-row-${row.kind}-status`"
        />
      </li>
    </ul>

    <div class="flex flex-wrap items-center gap-2">
      <OButton
        v-if="status !== 'forbidden'"
        class="w-68"
        variant="primary"
        size="sm-action"
        :disabled="busy"
        :loading="busy"
        :data-test="primaryTestId ?? `${testId}-setup-btn`"
        @click="emit('install')"
      >
        {{ primaryText }}
      </OButton>
      <OButton
        v-if="status !== 'forbidden' && status !== 'checking'"
        variant="ghost-primary"
        size="sm-action"
        :data-test="`${testId}-details-btn`"
        @click="emit('details')"
      >
        {{ t("starterPacks.guide.whatGetsCreated") }}
      </OButton>
      <slot name="actions" />
    </div>
  </OCard>
</template>
