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
    :title="t('synthetics.duplicate.title', { name: source?.name ?? '' })"
    data-test="synthetics-duplicate-dialog"
  >
    <div class="flex flex-col gap-3">
      <!-- Secrets arrive named but unset. Saying so before the click is the
           difference between a choice and a surprise when a check fails. -->
      <p class="text-text-secondary text-sm" data-test="synthetics-duplicate-summary">
        {{
          summary.secrets > 0
            ? t("synthetics.duplicate.bodyWithSecrets", {
                n: summary.total,
                name: source?.name ?? "",
                secrets: summary.secrets,
              })
            : t("synthetics.duplicate.body", { n: summary.total, name: source?.name ?? "" })
        }}
      </p>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="synthetics-duplicate-name">{{
          t("synthetics.duplicate.nameLabel")
        }}</label>
        <OInput
          id="synthetics-duplicate-name"
          v-model="name"
          data-test="synthetics-duplicate-name-input"
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
        data-test="synthetics-duplicate-confirm"
        @click="submit"
        >{{ t("synthetics.duplicate.confirm") }}</OButton
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
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import { duplicateNameFor, duplicateSummary } from "./scope";

const props = defineProps<{ open: boolean; source: SyntheticsEnvironment | null }>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [name: string] }>();

const { t } = useI18nTyped();
const store = useStore();
const name = ref("");
const saving = ref(false);

const summary = computed(() => duplicateSummary(props.source?.variables ?? []));

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) name.value = duplicateNameFor(props.source?.name ?? "");
  },
);

async function submit() {
  if (!props.source) return;
  saving.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    await syntheticsService.duplicateEnvironment(org, props.source.name, name.value.trim());
    // The parent selects the new scope, so the user lands where they just made.
    emit("done", name.value.trim());
    emit("update:open", false);
    toast({ variant: "success", message: t("synthetics.duplicate.done") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.response?.data?.message || t("synthetics.duplicate.failed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
