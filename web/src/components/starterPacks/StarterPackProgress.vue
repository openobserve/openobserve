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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

const props = defineProps<{
  flow: StarterPackFlow;
  /** Set when the alerts are created on and routed, so their row names the destination. */
  routedTo?: I18nText;
}>();
const emit = defineEmits<{ "copy-link": [] }>();

const { t } = useI18nTyped();

const ROW_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.progress.rowDashboards",
  alert: "starterPacks.progress.rowAlerts",
  savedView: "starterPacks.progress.rowViews",
};

const flow = props.flow;
const packTitle = t(flow.pack.titleKey);
const total = computed(() => flow.toCreate.value.length);
const made = computed(() => flow.made.value.length);
const failedCount = computed(() => flow.failed.value.length);
const title = computed(() =>
  flow.interrupted.value
    ? t("starterPacks.installDialog.title", { made: made.value, total: total.value })
    : t("starterPacks.progress.title", { title: packTitle }),
);
// The nav labels say where the pack lives, so the line follows a renamed menu.
const path = computed(() => raw(`${t("menu.data")} → ${t("menu.starterPacks")}`));

const alertsNote = (state: string): I18nText => {
  if (state === "creating") {
    return props.routedTo
      ? t("starterPacks.progress.alertsOnTo", { destination: props.routedTo })
      : t("starterPacks.progress.creating");
  }
  if (state === "waiting") return t("starterPacks.progress.waiting");
  if (props.routedTo) return t("starterPacks.progress.created");
  return t(
    flow.alertsOff.value > 0
      ? "starterPacks.progress.alertsOff"
      : "starterPacks.progress.alertsStarted",
  );
};

const kindRows = computed(() => {
  const firstPending = flow.toCreate.value.find(({ status }) => status === "pending")?.kind;
  return (["dashboard", "alert", "savedView"] as const).flatMap((kind) => {
    const items = flow.toCreate.value.filter((item) => item.kind === kind);
    if (!items.length) return [];
    const created = items.filter(({ status }) => status === "created").length;
    const label = t(ROW_KEYS[kind]!, { made: created, total: items.length });
    let state = "waiting";
    if (!items.some(({ status }) => status === "pending")) state = "created";
    else if (flow.running.value && kind === firstPending) state = "creating";
    const note =
      kind === "alert"
        ? alertsNote(state)
        : t(
            state === "created"
              ? "starterPacks.progress.created"
              : state === "creating"
                ? "starterPacks.progress.creating"
                : "starterPacks.progress.waiting",
          );
    return [{ kind, state, label, note }];
  });
});
</script>

<template>
  <div class="flex flex-col gap-3 text-sm" data-test="starter-pack-progress">
    <div class="flex flex-col gap-1">
      <h3 class="text-text-heading m-0 text-base font-semibold">{{ title }}</h3>
      <OText v-if="flow.running.value" variant="meta" data-test="starter-pack-progress-come-back">{{
        t("starterPacks.progress.comeBack", { made, total, path })
      }}</OText>
    </div>
    <OProgressBar
      :value="total ? made / total : 0"
      :variant="failedCount || flow.interrupted.value ? 'warning' : 'default'"
      data-test="starter-pack-progress-bar"
    />
    <OBanner
      v-if="flow.interrupted.value"
      variant="warning"
      icon="warning"
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
    <ul v-else class="m-0 flex list-none flex-col p-0" data-test="starter-pack-progress-list">
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
          variant="meta"
          class="shrink-0 text-right"
          :data-test="row.kind === 'alert' ? 'starter-pack-progress-alerts-note' : undefined"
          >{{ row.note }}</OText
        >
      </li>
    </ul>
  </div>
</template>
