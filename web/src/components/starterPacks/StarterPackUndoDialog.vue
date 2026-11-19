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
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import type { PackItemKind } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useUndoSummary } from "@/composables/starterPacks/useUndoSummary";

const props = defineProps<{ flow: StarterPackFlow; mode: "undo" | "remove" }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ done: [] }>();

const { t } = useI18nTyped();
const KIND_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.installDialog.kindDashboards",
  alert: "starterPacks.installDialog.kindAlerts",
  savedView: "starterPacks.installDialog.kindSavedViews",
};

const summary = useUndoSummary(props.flow);
const made = computed(() => props.flow.made.value);
const kindRows = computed(() =>
  (["dashboard", "alert", "savedView"] as const).flatMap((kind) => {
    const count = made.value.filter((item) => item.kind === kind).length;
    return count ? [{ kind, label: t(KIND_KEYS[kind]!), count }] : [];
  }),
);

const failed = ref(false);
const busy = computed(() => props.flow.busy.value);
watch(open, (isOpen) => {
  if (isOpen) failed.value = false;
});

const confirm = async () => {
  if (busy.value) return;
  failed.value = false;
  const work = props.mode === "undo" ? props.flow.undo : props.flow.remove;
  const ok = await work();
  // A partial removal still changed the pack, so listeners reload either way.
  emit("done");
  if (ok) open.value = false;
  else failed.value = true;
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="sm"
    :persistent="busy"
    :show-close="!busy"
    :title="t(mode === 'undo' ? 'starterPacks.undo.title' : 'starterPacks.undo.removeTitle')"
    :primary-button-label="
      t(mode === 'undo' ? 'starterPacks.landing.undo' : 'starterPacks.landing.remove')
    "
    primary-button-variant="destructive"
    :primary-button-data-test="
      mode === 'undo' ? 'starter-pack-undo-confirm-btn' : 'starter-pack-remove-confirm-btn'
    "
    :primary-button-loading="busy"
    :secondary-button-label="t('common.cancel')"
    :secondary-button-disabled="busy"
    initial-focus="secondary"
    data-test="starter-pack-undo-dialog"
    @click:primary="confirm"
    @click:secondary="open = false"
  >
    <div class="flex flex-col gap-3 text-sm">
      <OText v-if="mode === 'undo'" variant="meta">{{ summary.left.value }}</OText>
      <span data-test="starter-pack-undo-cover">{{ summary.cover.value }}</span>
      <strong class="text-text-heading">{{ summary.removes.value }}</strong>
      <ul
        class="border-border-default rounded-default flex flex-col border"
        data-test="starter-pack-undo-kinds"
      >
        <li
          v-for="row in kindRows"
          :key="row.kind"
          class="border-border-default flex items-center gap-2 border-t px-2 py-1.5 first:border-t-0"
        >
          <span class="flex-1">{{ row.label }}</span>
          <span class="tabular-nums">{{ row.count }}</span>
        </li>
      </ul>
      <OText variant="meta">{{ t("starterPacks.undo.keeps") }}</OText>
      <span v-if="failed" class="text-status-error-text" data-test="starter-pack-confirm-failed">{{
        t("starterPacks.undo.failed")
      }}</span>
    </div>
  </ODialog>
</template>
