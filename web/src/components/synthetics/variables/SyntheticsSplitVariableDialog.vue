<!--
Copyright 2026 OpenObserve Inc.

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

A split, not a move: one global row becomes N per-environment rows, each with
its own value. Values are collected here rather than filled in afterwards -
otherwise the author splits into three environments and then visits three pages
to fill three values, with checks unresolved in between.
-->

<template>
  <ODialog
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="t('synthetics.split.title', { name: variable?.name ?? '' })"
    data-test="synthetics-split-dialog"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary text-sm">{{ t("synthetics.split.description") }}</p>

      <div
        v-for="row in rows"
        :key="row.environment"
        class="flex items-center gap-2"
        data-test="synthetics-split-row"
      >
        <OCheckbox
          v-model="row.selected"
          :data-test="`synthetics-split-check-${row.environment}`"
        />
        <span class="w-32 shrink-0 font-mono text-sm">{{ row.environment }}</span>
        <OInput
          v-model="row.value"
          class="flex-1"
          :disabled="!row.selected"
          :placeholder="t('synthetics.split.valuePlaceholder')"
          :data-test="`synthetics-split-value-${row.environment}`"
        />
      </div>

      <!-- Every environment starts selected, so nothing breaks unless the
           author deliberately unticks one — and then it says what breaks. -->
      <OBanner v-if="unselected.length" variant="warning" data-test="synthetics-split-warning">
        {{ t("synthetics.split.unselectedWarning", { envs: unselected.join(", ") }) }}
      </OBanner>
    </div>

    <template #footer>
      <OButton variant="outline" size="sm" @click="$emit('update:open', false)">
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!selected.length"
        data-test="synthetics-split-confirm-btn"
        @click="submit"
        >{{ t("synthetics.split.confirm") }}</OButton
      >
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

const props = defineProps<{
  open: boolean;
  variable: SyntheticsVariable | null;
  environments: SyntheticsEnvironment[];
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const rows = ref<{ environment: string; value: string; selected: boolean }[]>([]);

const selected = computed(() => rows.value.filter((r) => r.selected));
const unselected = computed(() => rows.value.filter((r) => !r.selected).map((r) => r.environment));

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    // Selected by default: the destructive outcome is an environment being
    // left out, not one being included.
    rows.value = props.environments.map((e) => ({
      environment: e.name,
      value: "",
      selected: true,
    }));
  },
);

async function submit() {
  if (!props.variable) return;
  try {
    const org = store.state.selectedOrganization.identifier;
    await syntheticsService.splitGlobalVariable(
      org,
      props.variable.id,
      selected.value.map((r) => ({ environment: r.environment, value: r.value })),
    );
    emit("done");
    emit("update:open", false);
    toast({ variant: "success", message: t("synthetics.split.done") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.response?.data?.message || t("synthetics.split.failed"),
    });
  }
}
</script>
