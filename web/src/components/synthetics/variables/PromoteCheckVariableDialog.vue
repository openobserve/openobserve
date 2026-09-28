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
    :title="t('synthetics.promoteCheck.title', { name })"
    data-test="synthetics-promote-check-variable-dialog"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary text-sm">{{ t("synthetics.promoteCheck.description") }}</p>
      <OSelect
        :model-value="destination"
        :options="options"
        :label="t('synthetics.promoteCheck.destination')"
        data-test="synthetics-promote-check-variable-destination"
        @update:model-value="destination = String($event)"
      />
      <p v-if="secure" class="text-text-secondary text-xs">
        {{ t("synthetics.promoteCheck.secretHint") }}
      </p>
    </div>

    <template #footer>
      <OButton variant="outline" size="sm" @click="$emit('update:open', false)">
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!options.length || saving"
        data-test="synthetics-promote-check-variable-confirm"
        @click="submit"
        >{{ t("synthetics.promoteCheck.confirm") }}</OButton
      >
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import { serverMessage } from "./serverMessage";

const props = defineProps<{
  open: boolean;
  checkId: string;
  name: string;
  secure: boolean;
  /** Names of the environments the check runs in. */
  environments: string[];
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [name: string] }>();

const GLOBAL = "";

const { t } = useI18nTyped();
const store = useStore();
const destination = ref(GLOBAL);
const saving = ref(false);

const options = computed(() => [
  // The server keeps a secure value out of global, so it is not offered.
  ...(props.secure ? [] : [{ label: t("synthetics.promoteCheck.global"), value: GLOBAL }]),
  ...props.environments.map((env) => ({ label: raw(env), value: env })),
]);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) destination.value = String(options.value[0]?.value ?? GLOBAL);
  },
);

async function submit() {
  saving.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    await syntheticsService.promoteCheckVariable(
      org,
      props.checkId,
      props.name,
      destination.value === GLOBAL ? null : destination.value,
    );
    emit("done", props.name);
    emit("update:open", false);
    toast({ variant: "success", message: t("synthetics.promoteCheck.done") });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: serverMessage(error) ?? t("synthetics.promoteCheck.failed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
