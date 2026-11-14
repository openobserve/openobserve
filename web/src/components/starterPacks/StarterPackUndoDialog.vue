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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

const props = defineProps<{ flow: StarterPackFlow; mode: "undo" | "remove" }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ done: [] }>();

const { t } = useI18nTyped();
const HOUR_US = 60 * 60 * 1_000_000;
const KIND_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.installDialog.kindDashboards",
  alert: "starterPacks.installDialog.kindAlerts",
  savedView: "starterPacks.installDialog.kindSavedViews",
};

const hoursLeft = computed(() => Math.floor(props.flow.undoLeftUs.value / HOUR_US));
const made = computed(() => props.flow.made.value);
const kindRows = computed(() =>
  (["dashboard", "alert", "savedView"] as const).flatMap((kind) => {
    const count = made.value.filter((item) => item.kind === kind).length;
    return count ? [{ kind, label: t(KIND_KEYS[kind]!), count }] : [];
  }),
);
const names = computed(() =>
  made.value.map((item) => props.flow.nameOf(item.itemId)).join(raw(" · ")),
);

const confirm = async () => {
  const work = props.mode === "undo" ? props.flow.undo : props.flow.remove;
  open.value = false;
  await work();
  emit("done");
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="sm"
    :title="t(mode === 'undo' ? 'starterPacks.undo.title' : 'starterPacks.undo.removeTitle')"
    :primary-button-label="
      t(mode === 'undo' ? 'starterPacks.landing.undo' : 'starterPacks.landing.remove')
    "
    primary-button-variant="destructive"
    :primary-button-data-test="
      mode === 'undo' ? 'starter-pack-undo-confirm-btn' : 'starter-pack-remove-confirm-btn'
    "
    :secondary-button-label="t('common.cancel')"
    initial-focus="secondary"
    data-test="starter-pack-undo-dialog"
    @click:primary="confirm"
    @click:secondary="open = false"
  >
    <div class="flex flex-col gap-3 text-sm">
      <OText v-if="mode === 'undo'" variant="meta">{{
        hoursLeft > 0
          ? t("starterPacks.undo.left", { hours: hoursLeft })
          : t("starterPacks.undo.leftSoon")
      }}</OText>
      <strong class="text-text-heading">{{
        t("starterPacks.undo.removes", { count: made.length }, made.length)
      }}</strong>
      <ul class="flex flex-col" data-test="starter-pack-undo-kinds">
        <li
          v-for="row in kindRows"
          :key="row.kind"
          class="border-border-default flex items-center gap-2 border-b py-2"
        >
          <OIcon name="remove" size="sm" class="text-text-muted shrink-0" />
          <span class="flex-1">{{ row.label }}</span>
          <OText variant="meta">{{ row.count }}</OText>
        </li>
      </ul>
      <OText variant="meta" class="break-words" data-test="starter-pack-undo-items">{{
        raw(names)
      }}</OText>
      <OText variant="meta">{{
        flow.alertsOn.value > 0
          ? t("starterPacks.undo.loseCover", { count: flow.alertsOn.value }, flow.alertsOn.value)
          : t("starterPacks.undo.allOff")
      }}</OText>
      <OText variant="meta">{{ t("starterPacks.undo.keeps") }}</OText>
      <OText variant="meta">{{ t("starterPacks.undo.untouched") }}</OText>
    </div>
  </ODialog>
</template>
