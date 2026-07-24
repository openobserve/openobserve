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
    data-test="performance-fields-dialog"
    :open="modelValue"
    @update:open="(v) => $emit('update:modelValue', v)"
    persistent
    size="md"
    :title="t('logStream.performanceFieldsDialog.title')"
    :secondary-button-label="t('logStream.performanceFieldsDialog.skipButton')"
    :primary-button-label="t('logStream.performanceFieldsDialog.addFieldsButton')"
    @click:secondary="$emit('skip')"
    @click:primary="$emit('add-fields')"
  >
    <div v-if="fieldsByType.fts.length > 0" class="mb-2">
      <div class="mb-1 text-xs font-medium">
        {{ t("logStream.performanceFieldsDialog.ftsCount", { count: fieldsByType.fts.length }) }}
      </div>
      <div
        class="rounded-default border-border-default bg-surface-subtle max-h-50 overflow-y-auto border p-2"
      >
        <OTag
          v-for="field in fieldsByType.fts"
          :key="field.name"
          type="indexFieldType"
          value="fts"
          class="mr-1 mb-1"
        >
          {{ field.name }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${field.name}`"
              class="inline-flex cursor-pointer items-center justify-center hover:opacity-70"
              @click="$emit('remove-field', 'fts', field.name)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OTag>
      </div>
    </div>

    <div v-if="fieldsByType.secondaryIndex.length > 0">
      <div class="mb-1 text-xs font-medium">
        {{
          t("logStream.performanceFieldsDialog.secondaryIndexCount", {
            count: fieldsByType.secondaryIndex.length,
          })
        }}
      </div>
      <div
        class="rounded-default border-border-default bg-surface-subtle max-h-50 overflow-y-auto border p-2"
      >
        <OTag
          v-for="field in fieldsByType.secondaryIndex"
          :key="field.name"
          type="indexFieldType"
          value="secondaryIndex"
          class="mr-1 mb-1"
        >
          {{ field.name }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${field.name}`"
              class="inline-flex cursor-pointer items-center justify-center hover:opacity-70"
              @click="$emit('remove-field', 'secondaryIndex', field.name)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OTag>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export interface PerformanceField {
  name: string;
  type: string;
}

export default defineComponent({
  name: "PerformanceFieldsDialog",
  components: { ODialog, OTag, OIcon },
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    missingFields: {
      type: Array as PropType<PerformanceField[]>,
      required: true,
      default: () => [],
    },
  },
  emits: ["update:modelValue", "add-fields", "skip", "remove-field"],
  setup(props) {
    const { t } = useI18n();
    // Computed property to group missing fields by type
    const fieldsByType = computed(() => {
      return {
        fts: props.missingFields.filter((f) => f.type === "Full Text Search"),
        secondaryIndex: props.missingFields.filter((f) => f.type === "Secondary Index"),
      };
    });

    return {
      t,
      fieldsByType,
    };
  },
});
</script>
