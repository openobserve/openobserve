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
  <div class="semantic-group-item p-3 mb-2 rounded-lg transition-all duration-200 w-full max-w-full bg-card-glass-bg border border-(--color-card-glass-border,rgba(0,0,0,0.12))">
    <div class="grid grid-cols-[200px_1fr_auto] gap-4 items-start w-full overflow-hidden">
      <!-- Left Column: Display Name only (ID is internal/read-only) -->
      <div class="flex flex-col gap-1 min-w-0 justify-center">
        <div class="input-wrapper">
          <OInput
            data-test="semantic-group-display-input"
            v-model="localGroup.display"
            :label="t('common.name') + ' *'"
            :error="!!displayError"
            :error-message="displayError"
            class="showLabelOnTop"
            @update:model-value="handleDisplayChange"
            @blur="handleDisplayBlur"
          />
        </div>
        <!-- Show ID as read-only caption for existing groups -->
        <div v-if="localGroup.id" class="text-xs text-text-secondary">
          {{ t("common.id") }}: {{ localGroup.id }}
        </div>
        <OSwitch
          v-model="localGroup.is_workload_type"
          :label="t('correlation.isWorkloadType')"
          class="mt-1"
          @update:model-value="emitUpdate"
        >
          <OTooltip :content="t('correlation.isWorkloadTypeTooltip')" />
        </OSwitch>
      </div>

      <!-- Right Column: Field Names spanning both rows -->
      <div class="flex flex-col h-full min-w-0 overflow-hidden">
        <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TagInput
            v-model="localGroup.fields"
            :placeholder="t('correlation.fieldNamePlaceholder') + ' *'"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>


      <!-- Actions Column: Delete -->
      <div class="flex flex-col justify-between min-h-full">
        <div class="flex justify-end">
          <OButton
            data-test="semantic-group-remove-group-btn"
            :variant="isProtected ? 'ghost-muted' : 'ghost-destructive'"
            size="icon-circle-sm"
            :disabled="isProtected"
            @click="!isProtected && emit('delete')"
          >
            <OIcon name="delete" size="sm" />
            <OTooltip :content="isProtected ? t('correlation.serviceGroupProtected') : t('correlation.removeSemanticGroup')" />
          </OButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import TagInput from "./TagInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();

interface SemanticGroup {
  id: string;
  display: string;
  fields: string[];
  group?: string;
  is_workload_type?: boolean;
}

interface Props {
  group: SemanticGroup;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update", group: SemanticGroup): void;
  (e: "delete"): void;
}>();

const isProtected = computed(() => props.group.id === "service");

const normalizeGroup = (g: SemanticGroup): SemanticGroup => ({
  ...g,
  is_workload_type: g.is_workload_type ?? false,
});

const localGroup = ref<SemanticGroup>(normalizeGroup(props.group));
const displayError = ref("");

watch(
  () => props.group,
  (newGroup) => {
    localGroup.value = normalizeGroup(newGroup);
  },
  { deep: true },
);

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Generate ID as "{category-slug}-{display-slug}" for new groups
const generateIdFromDisplay = (display: string): string => {
  const displaySlug = slugify(display);
  const categorySlug = slugify(localGroup.value.group || "");
  return categorySlug ? `${categorySlug}-${displaySlug}` : displaySlug;
};

// Handle display name change (just emit, don't generate ID yet)
const handleDisplayChange = () => {
  displayError.value = "";
  emitUpdate();
};

// Handle display name blur - generate ID on focus out
const handleDisplayBlur = () => {
  if (!localGroup.value.display) {
    displayError.value = t('common.name') + ' is required';
  }
  // Generate ID from display name if display is not empty
  // If display is empty, keep the current ID (UUID or previous display-based ID)
  if (localGroup.value.display) {
    const newId = generateIdFromDisplay(localGroup.value.display);
    // Only update if ID actually changed
    if (localGroup.value.id !== newId) {
      localGroup.value.id = newId;
      emitUpdate();
    }
  }
};

const emitUpdate = () => {
  emit("update", { ...localGroup.value });
};
</script>
