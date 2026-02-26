<template>
  <q-dialog v-model="dialogVisible" persistent>
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">
          {{ isEditing ? "Edit" : "Add" }} Cross-Link
        </div>
      </q-card-section>

      <q-card-section>
        <q-form @submit.prevent="onSubmit">
          <!-- Name -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">Name *</label>
            <q-input
              v-model="form.name"
              dense
              placeholder="e.g., View Trace Details"
              :rules="[(val: string) => !!val || 'Name is required']"
              borderless
              hide-bottom-space
              data-test="cross-link-name-input"
            />
          </div>

          <!-- URL Template -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">URL Template *</label>
            <q-input
              v-model="form.url"
              dense
              placeholder="e.g., https://example.com/trace/${trace_id}"
              :rules="[(val: string) => !!val || 'URL is required']"
              borderless
              hide-bottom-space
              data-test="cross-link-url-input"
            />
            <div class="tw:text-xs tw:mt-1" style="color: var(--o2-text-muted)">
              Use ${field_name} for dynamic field values
            </div>
          </div>

          <!-- Fields -->
          <div class="tw:mb-2">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">Fields *</label>
            <div class="tw:text-xs tw:mb-2" style="color: var(--o2-text-muted)">
              Show link only when at least one field is present in the record
            </div>
            <div v-if="form.fields.length > 0" class="tw:flex tw:flex-wrap tw:gap-1 tw:mb-2">
              <q-chip
                v-for="(field, idx) in form.fields"
                :key="idx"
                removable
                dense
                class="tw:max-w-[250px]"
                @remove="form.fields.splice(idx, 1)"
                :data-test="`cross-link-field-chip-${idx}`"
              >
                <span class="tw:truncate tw:text-xs" :title="field.name">{{ field.name }}</span>
              </q-chip>
            </div>
            <div class="tw:flex tw:gap-2 tw:items-center">
              <q-select
                ref="fieldSelectRef"
                v-if="availableFields.length > 0"
                v-model="newFieldName"
                :options="filteredFieldOptions"
                use-input
                fill-input
                hide-selected
                input-debounce="0"
                @filter="filterFieldOptions"
                @input-value="onFieldInputValue"
                @update:model-value="onFieldSelected"
                @keyup.enter="addField"
                dense
                borderless
                class="tw:flex-1"
                placeholder="Type to search or enter custom field"
                hide-bottom-space
                data-test="cross-link-field-input"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="tw:text-xs" style="color: var(--o2-text-muted)">
                      No matching fields. Press Enter or + to add custom field.
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-input
                v-else
                v-model="newFieldName"
                dense
                borderless
                class="tw:flex-1"
                placeholder="Enter field name and press Enter or click +"
                @keyup.enter="addField"
                hide-bottom-space
                data-test="cross-link-field-input"
              />
              <q-btn
                dense
                flat
                round
                icon="add"
                color="primary"
                size="md"
                @click="addField"
                :disable="!newFieldName && !fieldInputValue"
                data-test="cross-link-add-field-btn"
              />
            </div>
          </div>
        </q-form>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          flat
          no-caps
          dense
          label="Cancel"
          class="o2-secondary-button tw:h-[36px]"
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="onCancel"
          data-test="cross-link-cancel-btn"
        />
        <q-btn
          flat
          no-caps
          dense
          :label="isEditing ? 'Update' : 'Add'"
          class="o2-primary-button tw:h-[36px] q-ml-md"
          :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          @click="onSubmit"
          :disable="!form.name || !form.url"
          data-test="cross-link-save-btn"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useStore } from "vuex";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
}

export default defineComponent({
  name: "CrossLinkDialog",
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    link: {
      type: Object as PropType<CrossLink | null>,
      default: null,
    },
    availableFields: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  emits: ["update:modelValue", "save", "cancel"],
  setup(props, { emit }) {
    const store = useStore();
    const dialogVisible = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const isEditing = computed(() => !!props.link?.name);
    const newFieldName = ref("");
    const fieldSelectRef = ref<any>(null);
    const filteredFieldOptions = ref<string[]>([]);

    function filterFieldOptions(val: string, update: Function) {
      update(() => {
        const needle = val.toLowerCase();
        filteredFieldOptions.value = props.availableFields.filter(
          (f) => f.toLowerCase().includes(needle),
        );
      });
    }

    const form = ref({
      name: "",
      url: "",
      fields: [] as Array<{ name: string }>,
    });

    // Track the raw input value from q-select (since v-model only updates on selection)
    const fieldInputValue = ref("");

    function onFieldInputValue(val: string) {
      fieldInputValue.value = val;
    }

    function clearFieldInput() {
      newFieldName.value = "";
      fieldInputValue.value = "";
      // Clear q-select's internal input text (use-input + fill-input caches it)
      if (fieldSelectRef.value?.updateInputValue) {
        fieldSelectRef.value.updateInputValue("", true);
      }
    }

    function onFieldSelected(val: string) {
      // When user selects from dropdown, auto-add immediately
      if (val) {
        const name = val.trim();
        if (name && !form.value.fields.some((f) => f.name === name)) {
          form.value.fields.push({ name });
        }
        clearFieldInput();
      }
    }

    function addField() {
      // Use fieldInputValue (raw typed text) if available, otherwise fall back to model
      const name = (fieldInputValue.value || newFieldName.value || "").trim();
      if (name && !form.value.fields.some((f) => f.name === name)) {
        form.value.fields.push({ name });
      }
      clearFieldInput();
    }

    // Reset form when dialog opens
    watch(
      () => props.modelValue,
      (visible) => {
        if (visible) {
          if (props.link) {
            form.value = {
              name: props.link.name,
              url: props.link.url,
              fields: props.link.fields
                ? props.link.fields.map((f) => ({ name: f.name }))
                : [],
            };
          } else {
            form.value = { name: "", url: "", fields: [] };
          }
          newFieldName.value = "";
        }
      },
    );

    function onSubmit() {
      if (!form.value.name || !form.value.url) return;
      // Auto-add pending field if user typed something but didn't press +
      addField();
      emit("save", { ...form.value });
    }

    function onCancel() {
      emit("cancel");
      emit("update:modelValue", false);
    }

    return {
      store,
      dialogVisible,
      isEditing,
      form,
      newFieldName,
      fieldInputValue,
      fieldSelectRef,
      filteredFieldOptions,
      filterFieldOptions,
      onFieldInputValue,
      onFieldSelected,
      addField,
      onSubmit,
      onCancel,
    };
  },
});
</script>
