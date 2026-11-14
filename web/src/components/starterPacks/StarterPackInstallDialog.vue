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
import { computed, ref, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackInlineConfirm from "./StarterPackInlineConfirm.vue";

const props = defineProps<{ flow: StarterPackFlow }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  "open-landing": [];
  manage: [];
  done: [];
  retry: [];
  "copy-link": [];
}>();

const { t } = useI18nTyped();

const KIND_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.installDialog.kindDashboards",
  alert: "starterPacks.installDialog.kindAlerts",
  savedView: "starterPacks.installDialog.kindSavedViews",
};

const flow = props.flow;
const confirming = ref(false);
watch(open, (isOpen) => {
  if (!isOpen) confirming.value = false;
});
const total = computed(() => flow.toCreate.value.length);
const made = computed(() => flow.made.value.length);
const failedCount = computed(() => flow.failed.value.length);
const packTitle = t(flow.pack.titleKey);
const title = computed(() =>
  !flow.running.value && total.value > 0 && made.value === total.value
    ? t("starterPacks.installDialog.doneTitle", { title: packTitle })
    : t("starterPacks.progress.title", { title: packTitle }),
);
const subTitle = computed(() => {
  const counts = { made: made.value, total: total.value };
  if (failedCount.value) {
    return t("starterPacks.progress.summaryRetry", { ...counts, failed: failedCount.value });
  }
  if (flow.running.value) return t("starterPacks.installDialog.subtitleRunning", counts);
  if (total.value > 0 && made.value === total.value) {
    if (flow.alertsOff.value > 0) return t("starterPacks.installDialog.subtitleDone", counts);
    if (flow.alertsTotal.value > 0) {
      return t("starterPacks.installDialog.subtitleDoneStarted", counts);
    }
  }
  return t("starterPacks.progress.summary", counts);
});
const kindRows = computed(() => {
  const firstPending = flow.toCreate.value.find(({ status }) => status === "pending")?.kind;
  return (["dashboard", "alert", "savedView"] as const).flatMap((kind) => {
    const items = flow.toCreate.value.filter((item) => item.kind === kind);
    if (!items.length) return [];
    const kindName = t(KIND_KEYS[kind]!);
    const created = items.filter(({ status }) => status === "created").length;
    const counts = { kind: kindName, made: created, total: items.length };
    if (!items.some(({ status }) => status === "pending")) {
      return [
        { kind, state: "created", label: t("starterPacks.installDialog.rowCreated", counts) },
      ];
    }
    if (flow.running.value && kind === firstPending) {
      return [
        { kind, state: "creating", label: t("starterPacks.installDialog.rowCreating", counts) },
      ];
    }
    return [
      {
        kind,
        state: "waiting",
        label: t("starterPacks.installDialog.rowWaiting", { kind: kindName }),
      },
    ];
  });
});
const firstDashboard = computed(() => flow.made.value.find(({ kind }) => kind === "dashboard"));
const openLabel = computed(() =>
  firstDashboard.value
    ? t("starterPacks.installDialog.open", {
        name: raw(flow.nameOf(firstDashboard.value.itemId)),
      })
    : flow.dashboardItem.value?.id
      ? t("starterPacks.drawer.openDashboard")
      : t("starterPacks.libraryTabs.openPack"),
);
</script>

<template>
  <ODialog
    v-model:open="open"
    size="sm"
    :persistent="flow.running.value || flow.busy.value"
    :show-close="!flow.running.value && !flow.busy.value"
    :title="title"
    :sub-title="subTitle"
    data-test="starter-pack-install-dialog"
  >
    <div class="flex flex-col gap-3 text-sm" data-test="starter-pack-progress">
      <OProgressBar
        :value="total ? made / total : 0"
        :variant="failedCount ? 'warning' : 'default'"
        data-test="starter-pack-progress-bar"
      />
      <OBanner
        v-if="flow.interrupted.value && !failedCount"
        variant="warning"
        dense
        :content="t('starterPacks.progress.interrupted', { made, total })"
      />
      <OBanner
        v-if="flow.installFailed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.progress.installError')"
      />
      <div v-if="failedCount" class="flex flex-col" data-test="starter-pack-progress-failed">
        <div
          v-for="item in flow.failed.value"
          :key="item.itemId"
          class="border-border-default flex items-start gap-2 border-b py-2"
          data-test="starter-pack-progress-failed-row"
        >
          <OIcon name="error" size="sm" class="text-status-error-text mt-0.5 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col">
            <strong>{{
              t("starterPacks.installDialog.rowFailed", { name: raw(flow.nameOf(item.itemId)) })
            }}</strong>
            <OText variant="meta">{{
              flow.forbidden.value
                ? t("starterPacks.noPermission")
                : t("starterPacks.installDialog.failedReason")
            }}</OText>
          </div>
          <OButton
            v-if="flow.forbidden.value"
            variant="outline"
            size="sm-action"
            data-test="starter-pack-progress-ask-admin-btn"
            @click="emit('copy-link')"
          >
            {{ t("starterPacks.askAdmin") }}
          </OButton>
        </div>
      </div>
      <ul class="flex flex-col" data-test="starter-pack-progress-list">
        <li
          v-for="row in kindRows"
          :key="row.kind"
          class="border-border-default flex items-center gap-2 border-b py-2"
          :data-test="`starter-pack-progress-kind-${row.state}-row`"
        >
          <OSpinner v-if="row.state === 'creating'" size="xs" class="shrink-0" />
          <OIcon
            v-else
            :name="row.state === 'created' ? 'check-circle' : 'schedule'"
            size="sm"
            :class="[
              'shrink-0',
              row.state === 'created' ? 'text-status-positive' : 'text-text-muted',
            ]"
          />
          <span class="min-w-0 flex-1">{{ row.label }}</span>
          <OText
            v-if="row.kind === 'alert' && row.state === 'created'"
            variant="meta"
            data-test="starter-pack-progress-alerts-note"
            >{{
              t(
                flow.alertsOff.value > 0
                  ? "starterPacks.progress.alertsOff"
                  : "starterPacks.progress.alertsStarted",
              )
            }}</OText
          >
        </li>
      </ul>
    </div>

    <template #footer>
      <StarterPackInlineConfirm
        v-if="confirming"
        :flow="flow"
        mode="undo"
        data-test="starter-pack-progress-confirm"
        @cancel="confirming = false"
        @done="emit('done')"
      />
      <div v-else class="flex w-full items-center gap-2">
        <OButton
          v-if="flow.canUndo.value && !flow.running.value && made > 0"
          variant="ghost-destructive"
          size="sm-action"
          data-test="starter-pack-progress-undo-btn"
          @click="confirming = true"
        >
          {{ t("starterPacks.installDialog.undoSetup") }}
        </OButton>
        <span class="flex-1" />
        <OButton
          v-if="flow.running.value"
          variant="primary"
          size="sm-action"
          disabled
          loading
          data-test="starter-pack-progress-running-btn"
        >
          {{ t("starterPacks.installDialog.settingUp") }}
        </OButton>
        <template v-else>
          <OButton
            v-if="failedCount && !flow.forbidden.value"
            variant="outline"
            size="sm-action"
            icon-left="refresh"
            data-test="starter-pack-progress-retry-btn"
            @click="emit('retry')"
          >
            {{ t("starterPacks.progress.retry", { count: failedCount }, failedCount) }}
          </OButton>
          <OButton
            v-else-if="flow.interrupted.value && !failedCount"
            variant="outline"
            size="sm-action"
            data-test="starter-pack-progress-finish-btn"
            @click="emit('retry')"
          >
            {{ t("starterPacks.progress.finish") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="starter-pack-progress-manage-btn"
            @click="emit('manage')"
          >
            {{ t("starterPacks.installDialog.manage") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="starter-pack-progress-open-btn"
            @click="emit('open-landing')"
          >
            {{ openLabel }}
          </OButton>
        </template>
      </div>
    </template>
  </ODialog>
</template>
