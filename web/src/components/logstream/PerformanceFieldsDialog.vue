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
  <ODialog data-test="performance-fields-dialog" :open="modelValue" @update:open="(v) => $emit('update:modelValue', v)" persistent size="md" title="Index Fields Detected"
    secondary-button-label="Skip"
    primary-button-label="Add Fields"
    @click:secondary="$emit('skip')"
    @click:primary="$emit('add-fields')"
  >
    <div v-if="fieldsByType.fts.length > 0" class="tw:mb-2">
      <div class="tw:text-xs text-weight-medium tw:mb-1">
        Full Text Search ({{ fieldsByType.fts.length }})
      </div>
      <div class="performance-fields-container bordered-scroll-area" :class="store.state.theme === 'dark' ? 'bordered-scroll-area-dark' : 'bordered-scroll-area-light'">
        <OBadge
          v-for="field in fieldsByType.fts"
          :key="field.name"
          variant="primary-soft"
          size="sm"
          class="tw:mr-1 tw:mb-1"
        >
          {{ field.name }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${field.name}`"
              class="tw:inline-flex tw:items-center tw:justify-center tw:cursor-pointer tw:hover:opacity-70"
              @click="$emit('remove-field', 'fts', field.name)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OBadge>
      </div>
    </div>

    <div v-if="fieldsByType.secondaryIndex.length > 0">
      <div class="tw:text-xs text-weight-medium tw:mb-1">
        Secondary Index ({{ fieldsByType.secondaryIndex.length }})
      </div>
      <div class="performance-fields-container bordered-scroll-area" :class="store.state.theme === 'dark' ? 'bordered-scroll-area-dark' : 'bordered-scroll-area-light'">
        <OBadge
          v-for="field in fieldsByType.secondaryIndex"
          :key="field.name"
          variant="success-soft"
          size="sm"
          class="tw:mr-1 tw:mb-1"
        >
          {{ field.name }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${field.name}`"
              class="tw:inline-flex tw:items-center tw:justify-center tw:cursor-pointer tw:hover:opacity-70"
              @click="$emit('remove-field', 'secondaryIndex', field.name)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OBadge>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from "vue";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export interface PerformanceField {
  name: string;
  type: string;
}

export default defineComponent({
  name: "PerformanceFieldsDialog",
  components: { ODialog, OBadge, OIcon },
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
    const store = useStore();

    // Computed property to group missing fields by type
    const fieldsByType = computed(() => {
      return {
        fts: props.missingFields.filter((f) => f.type === "Full Text Search"),
        secondaryIndex: props.missingFields.filter(
          (f) => f.type === "Secondary Index"
        ),
      };
    });

    return {
      store,
      fieldsByType,
    };
  },
});
</script>

<style lang="scss" scoped>
.performance-fields-description {
  color: var(--o2-text-muted);
}

.bordered-scroll-area {
  border: 1px solid;
  border-radius: 4px;
}

.bordered-scroll-area-light {
  border-color: #e0e0e0;
  background-color: #f5f5f5;
}

.bordered-scroll-area-dark {
  border-color: #3a3a3a;
  background-color: #1e1e1e;
}

.performance-fields-container {
  padding: 8px;
  max-height: 200px;
  overflow-y: auto;
}
</style>
