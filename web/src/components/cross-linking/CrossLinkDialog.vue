<template>
  <ODialog data-test="cross-link-dialog" v-model:open="dialogVisible" persistent size="md" :show-close="false"
    :title="isEditing ? t('crossLinks.editCrossLink') : t('crossLinks.addCrossLink')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('crossLinks.update') : t('crossLinks.add')"
    :primary-button-disabled="!form.name || !form.url"
    @click:secondary="onCancel"
    @click:primary="onSubmit"
  >
    <template #header-right>
      <CrossLinkUserGuide />
    </template>
        <q-form @submit.prevent="onSubmit">
          <!-- Name -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">{{ t("crossLinks.name") }} *</label>
            <q-input
              v-model="form.name"
              dense
              :placeholder="t('crossLinks.namePlaceholder')"
              :rules="[(val: string) => !!val || t('crossLinks.nameRequired')]"
              borderless
              hide-bottom-space
              data-test="cross-link-name-input"
            />
          </div>

          <!-- URL Template -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">{{ t("crossLinks.urlTemplate") }} *</label>
            <q-input
              v-model="form.url"
              dense
              :placeholder="t('crossLinks.urlPlaceholder')"
              :rules="[(val: string) => !!val || t('crossLinks.urlRequired')]"
              borderless
              hide-bottom-space
              data-test="cross-link-url-input"
            />
            <div class="tw:text-xs tw:mt-1" style="color: var(--o2-text-muted)">
              {{ t("crossLinks.urlHint") }}
            </div>
          </div>

          <!-- Fields -->
          <div class="tw:mb-2">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">{{ t("crossLinks.fields") }} *</label>
            <div class="tw:text-xs tw:mb-2" style="color: var(--o2-text-muted)">
              {{ t("crossLinks.fieldsHint") }}
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
                :placeholder="t('crossLinks.fieldSearchPlaceholder')"
                hide-bottom-space
                data-test="cross-link-field-input"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="tw:text-xs" style="color: var(--o2-text-muted)">
                      {{ t("crossLinks.noMatchingFields") }}
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
                :placeholder="t('crossLinks.fieldInputPlaceholder')"
                @keyup.enter="addField"
                hide-bottom-space
                data-test="cross-link-field-input"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="add"
                @click="addField"
                :disabled="!newFieldName && !fieldInputValue"
                data-test="cross-link-add-field-btn"
              />
            </div>
          </div>
        </q-form>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import CrossLinkUserGuide from "./CrossLinkUserGuide.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
}

export default defineComponent({
  name: "CrossLinkDialog",
  components: { CrossLinkUserGuide, OButton, ODialog, },
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
    const { t } = useI18n();
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
      t,
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
