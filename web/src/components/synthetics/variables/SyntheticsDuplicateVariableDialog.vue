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

The copy lands in the scope it was made from. Offering a scope picker here
would duplicate what Make global and Scope to environments already do, and
those carry guards this dialog does not.

Plain variables only: a secret's value cannot be copied, so the list routes
that row to the create form instead.
-->

<template>
  <ODialog
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="t('synthetics.duplicate.title', { name: source?.name ?? '' })"
    data-test="synthetics-duplicate-variable-dialog"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary text-sm" data-test="synthetics-duplicate-variable-summary">
        {{ t("synthetics.duplicateVariable.body", { name: source?.name ?? "" }) }}
      </p>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="synthetics-duplicate-variable-name">{{
          t("synthetics.duplicateVariable.nameLabel")
        }}</label>
        <OInput
          id="synthetics-duplicate-variable-name"
          v-model="name"
          data-test="synthetics-duplicate-variable-name-input"
        />
      </div>
    </div>

    <template #footer>
      <OButton variant="outline" size="sm" @click="$emit('update:open', false)">
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!name.trim() || saving"
        data-test="synthetics-duplicate-variable-confirm"
        @click="submit"
        >{{ t("synthetics.duplicate.confirm") }}</OButton
      >
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsVariablePayload } from "@/services/synthetics";
import type { SyntheticsVariable } from "@/types/synthetics";
import { duplicateVariableNameFor } from "./scope";

const props = defineProps<{
  open: boolean;
  source: SyntheticsVariable | null;
  /** The environment the row belongs to, or null on Global. */
  environment: string | null;
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const name = ref("");
const saving = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) name.value = duplicateVariableNameFor(props.source?.name ?? "");
  },
);

async function submit() {
  if (!props.source) return;
  saving.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const payload: SyntheticsVariablePayload = {
      name: name.value.trim(),
      kind: props.source.kind,
      description: props.source.description,
      example: props.source.example,
      tags: props.source.tags,
      value: props.source.value ?? "",
    };
    await (props.environment
      ? syntheticsService.createEnvironmentVariable(org, props.environment, payload)
      : syntheticsService.createGlobalVariable(org, payload));
    // Refresh and close before the toast: those are the effects being waited on.
    emit("done");
    emit("update:open", false);
    toast({ variant: "success", message: t("synthetics.duplicateVariable.done") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.response?.data?.message || t("synthetics.duplicateVariable.failed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
