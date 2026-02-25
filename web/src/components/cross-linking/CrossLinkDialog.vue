<template>
  <q-dialog v-model="dialogVisible" persistent>
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">
          {{ isEditing ? "Edit" : "Add" }} Cross-Link
        </div>
      </q-card-section>

      <q-card-section>
        <q-form @submit.prevent="onSubmit" class="tw:space-y-4">
          <!-- Name -->
          <q-input
            v-model="form.name"
            label="Name *"
            outlined
            dense
            :rules="[(val: string) => !!val || 'Name is required']"
            data-test="cross-link-name-input"
          />

          <!-- URL Template -->
          <q-input
            v-model="form.url"
            label="URL Template *"
            outlined
            dense
            :rules="[(val: string) => !!val || 'URL is required']"
            hint="Use {field_name} for dynamic field values. Example: https://example.com/trace/{trace_id}"
            data-test="cross-link-url-input"
          />

          <!-- Fields -->
          <div>
            <div class="tw:text-sm tw:font-medium tw:mb-1">Fields *</div>
            <div class="tw:text-xs tw:text-gray-500 tw:mb-2">
              Show link only when at least one field is present in the record
            </div>
            <div class="tw:flex tw:flex-wrap tw:gap-1 tw:mb-2">
              <q-chip
                v-for="(field, idx) in form.fields"
                :key="idx"
                removable
                dense
                @remove="form.fields.splice(idx, 1)"
                :data-test="`cross-link-field-chip-${idx}`"
              >
                {{ field.name }}
              </q-chip>
            </div>
            <div class="tw:flex tw:gap-2">
              <q-input
                v-model="newFieldName"
                dense
                outlined
                placeholder="Field name"
                @keyup.enter="addField"
                data-test="cross-link-field-input"
              />
              <q-btn
                dense
                flat
                icon="add"
                @click="addField"
                :disable="!newFieldName"
                data-test="cross-link-add-field-btn"
              />
            </div>
          </div>
        </q-form>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          flat
          label="Cancel"
          @click="onCancel"
          data-test="cross-link-cancel-btn"
        />
        <q-btn
          color="primary"
          :label="isEditing ? 'Update' : 'Add'"
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
  },
  emits: ["update:modelValue", "save", "cancel"],
  setup(props, { emit }) {
    const dialogVisible = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const isEditing = computed(() => !!props.link?.name);
    const newFieldName = ref("");

    const form = ref({
      name: "",
      url: "",
      fields: [] as Array<{ name: string }>,
    });

    function addField() {
      const name = newFieldName.value.trim();
      if (name && !form.value.fields.some((f) => f.name === name)) {
        form.value.fields.push({ name });
        newFieldName.value = "";
      }
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
      emit("save", { ...form.value });
    }

    function onCancel() {
      emit("cancel");
      emit("update:modelValue", false);
    }

    return {
      dialogVisible,
      isEditing,
      form,
      newFieldName,
      addField,
      onSubmit,
      onCancel,
    };
  },
});
</script>
