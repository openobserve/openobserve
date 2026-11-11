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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

const props = defineProps<{ flow: StarterPackFlow }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  "open-landing": [];
  manage: [];
  undo: [];
  retry: [];
  "copy-link": [];
}>();

const { t } = useI18nTyped();

const TYPE_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.installDialog.typeDashboard",
  alert: "starterPacks.installDialog.typeAlert",
  savedView: "starterPacks.installDialog.typeSavedView",
};

const flow = props.flow;
const total = computed(() => flow.toCreate.value.length);
const made = computed(() => flow.made.value.length);
const failedCount = computed(() => flow.failed.value.length);
const title = computed(() => {
  const base = t("starterPacks.installDialog.title", { made: made.value, total: total.value });
  return failedCount.value
    ? t(
        "starterPacks.installDialog.attention",
        { title: base, count: failedCount.value },
        failedCount.value,
      )
    : base;
});
const firstDashboard = computed(() => flow.made.value.find(({ kind }) => kind === "dashboard"));
const openLabel = computed(() =>
  firstDashboard.value
    ? t("starterPacks.installDialog.open", {
        name: raw(flow.nameOf(firstDashboard.value.itemId)),
      })
    : t("starterPacks.drawer.openDashboard"),
);
const typeOf = (kind: PackItemKind) => {
  const key = TYPE_KEYS[kind];
  return key ? t(key) : raw(kind);
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="sm"
    :persistent="flow.running.value"
    :show-close="!flow.running.value"
    :title="title"
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
        <OText variant="section" class="text-text-error">{{
          t("starterPacks.installDialog.couldNot", { count: failedCount })
        }}</OText>
        <div
          v-for="item in flow.failed.value"
          :key="item.itemId"
          class="border-border-default flex items-start gap-2 border-b py-2"
          data-test="starter-pack-progress-failed-row"
        >
          <OIcon name="error" size="sm" class="text-text-error mt-0.5" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span>{{ raw(flow.nameOf(item.itemId)) }}</span>
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
      <div class="flex flex-col" data-test="starter-pack-progress-list">
        <OText variant="section">{{
          t("starterPacks.installDialog.created", { count: made })
        }}</OText>
        <div
          v-for="item in flow.made.value"
          :key="item.itemId"
          class="border-border-default flex items-center gap-2 border-b py-2"
          data-test="starter-pack-progress-created-row"
        >
          <OIcon name="check-circle" size="sm" class="text-text-success" />
          <span class="min-w-0 flex-1 truncate">{{ raw(flow.nameOf(item.itemId)) }}</span>
          <OText variant="meta">{{ typeOf(item.kind) }}</OText>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <OButton
          v-if="flow.canUndo.value && !flow.running.value && made > 0"
          variant="ghost-destructive"
          size="sm-action"
          data-test="starter-pack-progress-undo-btn"
          @click="emit('undo')"
        >
          {{ t("starterPacks.installDialog.undoAll", { count: made }) }}
        </OButton>
        <span class="flex-1" />
        <template v-if="!flow.running.value">
          <OButton
            v-if="failedCount && !flow.forbidden.value"
            variant="outline"
            size="sm-action"
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
