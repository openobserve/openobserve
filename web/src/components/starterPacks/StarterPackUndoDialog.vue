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
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

const props = defineProps<{ flow: StarterPackFlow; mode: "undo" | "remove" }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ done: [] }>();

const { t } = useI18nTyped();
const HOUR_US = 60 * 60 * 1_000_000;

const hoursLeft = computed(() => Math.floor(props.flow.undoLeftUs.value / HOUR_US));
const made = computed(() => props.flow.made.value);
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
    <div class="flex flex-col gap-2 text-sm">
      <OText v-if="mode === 'undo'" class="text-text-error">{{
        hoursLeft > 0
          ? t("starterPacks.undo.left", { hours: hoursLeft })
          : t("starterPacks.undo.leftSoon")
      }}</OText>
      <p>
        {{
          flow.alertsOn.value > 0
            ? t("starterPacks.undo.loseCover", { count: flow.alertsOn.value }, flow.alertsOn.value)
            : t("starterPacks.undo.allOff")
        }}
      </p>
      <strong>{{ t("starterPacks.undo.removes", { count: made.length }, made.length) }}</strong>
      <p data-test="starter-pack-undo-items">{{ raw(names) }}</p>
      <OText variant="meta">{{ t("starterPacks.undo.keeps") }}</OText>
    </div>
  </ODialog>
</template>
