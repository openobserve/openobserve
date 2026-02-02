<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="semantic-group-item q-pa-md q-mb-sm">
    <div class="group-layout">
      <!-- Left Column: Display Name only (ID is internal/read-only) -->
      <div class="left-column">
        <div class="input-wrapper">
          <q-input
            data-test="semantic-group-display-input"
            v-model="localGroup.display"
            :label="t('common.name') + ' *'"
            :rules="[(val) => !!val || t('common.name') + ' is required']"
            dense
            borderless
            stack-label
            class="showLabelOnTop"
            @update:model-value="handleDisplayChange"
          />
        </div>
        <!-- Show ID as read-only caption for existing groups -->
        <div v-if="localGroup.id" class="text-caption text-grey-6">
          {{ t("common.id") }}: {{ localGroup.id }}
        </div>
      </div>

      <!-- Right Column: Field Names spanning both rows -->
      <div class="right-column">
        <div class="field-names-input">
          <TagInput
            v-model="localGroup.fields"
            :placeholder="t('correlation.fieldNamePlaceholder') + ' *'"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>

      <!-- Actions Column: Scope, Stable, Normalize and Delete -->
      <div class="actions-column">
        <div class="checkboxes-row q-mb-sm">
          <q-checkbox
            data-test="semantic-group-action-scope-chkbox"
            v-model="localGroup.is_scope"
            size="sm"
            dense
            @update:model-value="emitUpdate"
          >
            <span class="checkbox-label">{{ t('correlation.scope') }}</span>
            <q-tooltip max-width="300px">{{ t('correlation.scopeTooltip') }}</q-tooltip>
          </q-checkbox>
          <q-checkbox
            data-test="semantic-group-action-stable-chkbox"
            v-model="localGroup.is_stable"
            size="sm"
            dense
            @update:model-value="emitUpdate"
          >
            <span class="checkbox-label">{{ t('correlation.stable') }}</span>
            <q-tooltip max-width="300px">{{ t('correlation.stableTooltip') }}</q-tooltip>
          </q-checkbox>
          <q-checkbox
            data-test="semantic-group-action-normalize-chkbox"
            v-model="localGroup.normalize"
            size="sm"
            dense
            @update:model-value="emitUpdate"
          >
            <span class="checkbox-label">{{ t('correlation.normalize') }}</span>
            <q-tooltip>{{ t("correlation.actionNormalize") }}</q-tooltip>
          </q-checkbox>
        </div>
        <div class="flex justify-end">
          <q-btn
            data-test="semantic-group-remove-group-btn"
            flat
            round
            dense
            color="negative"
            icon="delete"
            @click="emit('delete')"
          >
            <q-tooltip>{{ t("correlation.removeSemanticGroup") }}</q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import TagInput from "./TagInput.vue";

const { t } = useI18n();

interface SemanticGroup {
  id: string;
  display: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
  is_scope?: boolean;
}

interface Props {
  group: SemanticGroup;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update", group: SemanticGroup): void;
  (e: "delete"): void;
}>();

const localGroup = ref<SemanticGroup>({ ...props.group });

watch(
  () => props.group,
  (newGroup) => {
    localGroup.value = { ...newGroup };
  },
  { deep: true },
);

// Auto-generate ID from display name for new groups (when ID is empty)
const generateIdFromDisplay = (display: string): string => {
  return display
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

// Handle display name change - auto-generate ID for new groups
const handleDisplayChange = () => {
  // Only auto-generate ID if it's empty (new group)
  if (!props.group.id && localGroup.value.display) {
    localGroup.value.id = generateIdFromDisplay(localGroup.value.display);
  }
  emitUpdate();
};

const emitUpdate = () => {
  emit("update", { ...localGroup.value });
};
</script>

<style lang="scss" scoped>
.semantic-group-item {
  border-radius: 8px;
  transition: all 0.2s ease;
  width: 100%;
  max-width: 100%;
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.12));
}

.group-layout {
  display: grid;
  grid-template-columns: 200px 1fr auto;
  gap: 16px;
  align-items: start;
  width: 100%;
  overflow: hidden;
}

.left-column {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  justify-content: center;
}

.right-column {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.field-names-input {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;

  :deep(.tag-input-container) {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  :deep(.tag-input-wrapper) {
    flex: 1;
    min-height: 100px;
    min-width: 0;
  }
}

.actions-column {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 100%;
}

.checkboxes-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-label {
  font-size: 12px;
  margin-left: 4px;
}

.text-subtitle2 {
  font-size: 12px;
  font-weight: 500;
  color: var(--q-color-text-secondary);
}

@media (max-width: 768px) {
  .group-layout {
    grid-template-columns: 1fr;
  }
}
</style>
