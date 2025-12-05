<!-- Copyright 2023 OpenObserve Inc.

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
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card style="min-width: 500px; max-width: 650px">
      <q-card-section class="row items-center q-pb-sm q-pt-md q-px-md">
        <div class="text-subtitle1 text-weight-medium">Index Fields Detected</div>
        <q-space />
      </q-card-section>

      <q-card-section class="q-pt-none q-pb-sm q-px-md">
        <div class="text-body2 q-mb-sm performance-fields-description">
          We found some fields with full-text search or secondary indexes that are not included in your schema.
          These fields affects search performance and indexing behavior.
          Do you want to add them?
        </div>

        <div v-if="fieldsByType.fts.length > 0" class="q-mb-sm">
          <div class="text-caption text-weight-medium q-mb-xs">
            Full Text Search ({{ fieldsByType.fts.length }})
          </div>
          <div class="performance-fields-container bordered-scroll-area" :class="store.state.theme === 'dark' ? 'bordered-scroll-area-dark' : 'bordered-scroll-area-light'">
            <q-chip
              v-for="field in fieldsByType.fts"
              :key="field.name"
              :color="store.state.theme === 'dark' ? 'blue-9' : 'blue-2'"
              :text-color="store.state.theme === 'dark' ? 'blue-2' : 'blue-9'"
              size="sm"
              class="q-mr-xs q-mb-xs"
              removable
              @remove="$emit('remove-field', 'fts', field.name)"
            >
              {{ field.name }}
            </q-chip>
          </div>
        </div>

        <div v-if="fieldsByType.secondaryIndex.length > 0">
          <div class="text-caption text-weight-medium q-mb-xs">
            Secondary Index ({{ fieldsByType.secondaryIndex.length }})
          </div>
          <div class="performance-fields-container bordered-scroll-area" :class="store.state.theme === 'dark' ? 'bordered-scroll-area-dark' : 'bordered-scroll-area-light'">
            <q-chip
              v-for="field in fieldsByType.secondaryIndex"
              :key="field.name"
              :color="store.state.theme === 'dark' ? 'green-9' : 'green-2'"
              :text-color="store.state.theme === 'dark' ? 'green-2' : 'green-9'"
              size="sm"
              class="q-mr-xs q-mb-xs"
              removable
              @remove="$emit('remove-field', 'secondaryIndex', field.name)"
            >
              {{ field.name }}
            </q-chip>
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="right" class="q-pt-none q-pb-md q-px-md">
        <q-btn flat label="Skip" class="o2-secondary-button" @click="$emit('skip')" />
        <q-btn unelevated label="Add Fields" class="o2-primary-button" @click="$emit('add-fields')" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from "vue";
import { useStore } from "vuex";

export interface PerformanceField {
  name: string;
  type: string;
}

export default defineComponent({
  name: "PerformanceFieldsDialog",
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
