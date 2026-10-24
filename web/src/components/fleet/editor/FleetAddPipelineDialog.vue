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

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('fleet.editor.addPipeline')"
    :primary-button-label="t('fleet.common.create')"
    :primary-button-disabled="taken"
    :secondary-button-label="t('common.cancel')"
    data-test="fleet-add-pipeline-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="submit"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <OText variant="label">{{ t("fleet.editor.signal") }}</OText>
        <OToggleGroup
          :model-value="signal"
          data-test="fleet-add-pipeline-dialog-signal"
          @update:model-value="(v) => (signal = v as Signal)"
        >
          <OToggleGroupItem v-for="s in SIGNALS" :key="s" :value="s" size="sm">
            {{ raw(s) }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
      <OInput
        v-model="name"
        :label="t('fleet.editor.pipelineName')"
        :help-text="t('fleet.editor.pipelineNameHelp', { id: raw(pipelineId) })"
        :error="taken"
        :error-message="taken ? t('fleet.editor.pipelineExists') : undefined"
        :placeholder="raw('k8s')"
        data-test="fleet-add-pipeline-dialog-name"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { SIGNALS, type Signal } from "./editorGraph";

const props = defineProps<{ open: boolean; existing: string[] }>();
const emit = defineEmits<{ "update:open": [value: boolean]; create: [id: string] }>();

const { t } = useI18nTyped();

const signal = ref<Signal>("logs");
const name = ref("");

const pipelineId = computed(() => {
  const suffix = name.value.trim().replace(/\s+/g, "_");
  return suffix ? `${signal.value}/${suffix}` : signal.value;
});
const taken = computed(() => props.existing.includes(pipelineId.value));

function submit() {
  if (taken.value) return;
  emit("create", pipelineId.value);
  emit("update:open", false);
  name.value = "";
}
</script>
