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
    size="md"
    :title="t('aiToolset.presetReviewTitle', { name: row?.name ?? '' })"
    :sub-title="t('aiToolset.presetReviewHint')"
    :primary-button-label="t('aiToolset.presetApplySelected')"
    :secondary-button-label="t('aiToolset.presetDismiss')"
    :primary-button-disabled="!applied.size"
    :primary-button-loading="saving"
    data-test="ai-toolset-preset-review"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="save(applied)"
    @click:secondary="save(new Set())"
  >
    <div v-if="!diffs.length" class="text-text-secondary text-sm">
      {{ t("aiToolset.presetNothingChanged") }}
    </div>
    <div
      v-for="diff in diffs"
      :key="diff.field"
      class="border-border-default mb-2 border-b pb-2"
      :data-test="`ai-toolset-preset-diff-${diff.field}`"
    >
      <OCheckbox
        :model-value="applied.has(diff.field)"
        :label="t(FIELD_LABELS[diff.field])"
        @update:model-value="(v: any) => toggle(diff.field, !!v)"
      />
      <div class="mt-1 grid grid-cols-2 gap-2 font-mono text-xs">
        <pre class="whitespace-pre-wrap">{{ show(diff.current) }}</pre>
        <pre class="whitespace-pre-wrap">{{ show(diff.shipped) }}</pre>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import aiToolsetsService from "@/services/ai_toolsets";
import { presetDiff, reviewUpdate, type Preset, type PresetField } from "./presets";

const props = defineProps<{
  open: boolean;
  row: { id: string; name: string; description?: string; data: Record<string, any> } | null;
  preset: Preset | null;
}>();

const emit = defineEmits<{
  (_e: "update:open", _open: boolean): void;
  (_e: "saved"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const FIELD_LABELS: Record<PresetField, string> = {
  url: "aiToolset.mcpUrl",
  description: "aiToolset.description",
  allowed_tools: "aiToolset.listAllowed",
  write_tools: "aiToolset.listWrite",
  tool_classes: "aiToolset.toolClasses",
};

const diffs = computed(() =>
  props.row && props.preset ? presetDiff(props.row, props.preset) : [],
);
const applied = ref(new Set<PresetField>());
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) applied.value = new Set(diffs.value.map((d) => d.field));
  },
  { immediate: true },
);

const toggle = (field: PresetField, on: boolean) => {
  const next = new Set(applied.value);
  if (on) next.add(field);
  else next.delete(field);
  applied.value = next;
};

const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);

// A merge PUT: credentials aren't sent, so they stay as stored.
const save = async (fields: Set<PresetField>) => {
  if (!props.row || !props.preset) return;
  saving.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const body = reviewUpdate(props.row, props.preset, diffs.value, fields);
    await aiToolsetsService.update(org, props.row.id, body);
    emit("saved");
    emit("update:open", false);
  } catch (err: any) {
    toast({
      variant: "error",
      message: err?.response?.data?.message || t("aiToolset.presetReviewFailed"),
    });
  } finally {
    saving.value = false;
  }
};
</script>
