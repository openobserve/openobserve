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
      <p class="text-text-muted text-xs">{{ t("synthetics.split.overrideHint") }}</p>

      <OBanner v-if="usedBy.length" variant="info" data-test="synthetics-split-used-by">
        <p class="m-0">
          {{ t("synthetics.split.usedBy", { n: usedBy.length, names: usedBy.join(", ") }) }}
        </p>
        <p class="m-0 text-xs">{{ t("synthetics.split.usedByHint") }}</p>
      </OBanner>

      <div
        v-for="row in rows"
        :key="row.environment"
        class="flex items-center gap-2"
        data-test="synthetics-split-row"
      >
        <OCheckbox
          v-model="row.selected"
          :disabled="row.alreadyOwn"
          :data-test="`synthetics-split-check-${row.environment}`"
        />
        <span class="w-32 shrink-0 font-mono text-sm">{{ row.environment }}</span>
        <span
          v-if="row.alreadyOwn"
          class="text-text-muted flex-1 text-xs"
          data-test="synthetics-split-owned-note"
        >
          {{ t("synthetics.split.alreadyOwn") }}
        </span>
        <OInput
          v-else
          v-model="row.value"
          class="flex-1"
          :disabled="!row.selected"
          :placeholder="t('synthetics.split.valuePlaceholder')"
          :data-test="`synthetics-split-value-${row.environment}`"
        />
      </div>

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
        :disabled="!canConfirm"
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
import { serverMessage } from "./serverMessage";

const props = defineProps<{
  open: boolean;
  variable: SyntheticsVariable | null;
  environments: SyntheticsEnvironment[];
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const rows = ref<{ environment: string; value: string; selected: boolean; alreadyOwn: boolean }[]>(
  [],
);

const selected = computed(() => rows.value.filter((r) => r.selected));
const unselected = computed(() =>
  rows.value.filter((r) => !r.selected && !r.alreadyOwn).map((r) => r.environment),
);
// The global row is deleted by the split, so an empty value would be the only copy left.
const canConfirm = computed(
  () => selected.value.length > 0 && selected.value.every((r) => r.value.length > 0),
);
const usedBy = computed(() => props.variable?.used_by ?? []);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    rows.value = props.environments.map((e) => {
      const alreadyOwn = (e.variables ?? []).some((v) => v.name === props.variable?.name);
      return {
        environment: e.name,
        value: props.variable?.value ?? "",
        selected: !alreadyOwn,
        alreadyOwn,
      };
    });
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
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: serverMessage(error) ?? t("synthetics.split.failed"),
    });
  }
}
</script>
