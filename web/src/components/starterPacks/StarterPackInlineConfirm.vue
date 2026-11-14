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
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useUndoSummary } from "@/composables/starterPacks/useUndoSummary";

const props = defineProps<{ flow: StarterPackFlow; mode: "undo" | "remove" }>();
const emit = defineEmits<{ cancel: []; done: [] }>();

const { t } = useI18nTyped();
const summary = useUndoSummary(props.flow);
const failed = ref(false);
const busy = computed(() => props.flow.busy.value);

const note = computed(() =>
  [summary.removes.value, props.mode === "undo" && summary.left.value, summary.cover.value]
    .filter(Boolean)
    .join(raw(" · ")),
);

const confirm = async () => {
  if (busy.value) return;
  failed.value = false;
  const work = props.mode === "undo" ? props.flow.undo : props.flow.remove;
  if (await work()) emit("done");
  else failed.value = true;
};
</script>

<template>
  <div class="flex w-full items-center gap-2">
    <div class="flex min-w-0 flex-1 flex-col">
      <strong class="text-text-heading text-sm">{{
        t(mode === "undo" ? "starterPacks.undo.title" : "starterPacks.undo.removeTitle")
      }}</strong>
      <span
        v-if="failed"
        class="text-status-error-text truncate text-xs"
        data-test="starter-pack-confirm-failed"
        >{{ t("starterPacks.undo.failed") }}</span
      >
      <OText v-else variant="meta" class="truncate" :title="note">{{ note }}</OText>
    </div>
    <OButton
      variant="outline"
      size="sm-action"
      :disabled="busy"
      data-test="starter-pack-drawer-confirm-cancel-btn"
      @click="emit('cancel')"
    >
      {{ t("common.cancel") }}
    </OButton>
    <OButton
      variant="destructive"
      size="sm-action"
      :loading="busy"
      :data-test="
        mode === 'undo' ? 'starter-pack-undo-confirm-btn' : 'starter-pack-remove-confirm-btn'
      "
      @click="confirm"
    >
      {{ t(mode === "undo" ? "starterPacks.landing.undo" : "starterPacks.landing.remove") }}
    </OButton>
  </div>
</template>
