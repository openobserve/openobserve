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
        <div>
          <!-- Name -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">{{ t("crossLinks.name") }} *</label>
            <OInput
              v-model="form.name"
              :placeholder="t('crossLinks.namePlaceholder')"
              :error="!!nameError"
              :error-message="nameError"
              @update:model-value="nameError = ''"
              data-test="cross-link-name-input"
            />
          </div>

          <!-- URL Template -->
          <div class="tw:mb-3">
            <label class="tw:block tw:text-sm tw:font-semibold tw:mb-1" style="color: var(--o2-text-primary)">{{ t("crossLinks.urlTemplate") }} *</label>
            <OInput
              v-model="form.url"
              :placeholder="t('crossLinks.urlPlaceholder')"
              :error="!!urlError"
              :error-message="urlError"
              @update:model-value="urlError = ''"
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
              <OBadge
                v-for="(field, idx) in form.fields"
                :key="idx"
                variant="default"
                size="sm"
                class="tw:max-w-[250px]"
                :data-test="`cross-link-field-chip-${idx}`"
              >
                <span class="tw:truncate tw:text-xs" :title="field.name">{{ field.name }}</span>
                <template #trailing>
                  <button
                    type="button"
                    :aria-label="`Remove ${field.name}`"
                    :data-test="`cross-link-field-chip-remove-${idx}`"
                    class="tw:inline-flex tw:items-center tw:justify-center tw:cursor-pointer tw:hover:opacity-70"
                    @click="form.fields.splice(idx, 1)"
                  >
                    <OIcon name="close" size="xs" />
                  </button>
                </template>
              </OBadge>
            </div>
            <div
              class="tw:flex tw:gap-2 tw:items-center"
              @keydown="onFieldKeydown"
            >
              <!--
                OCombobox provides suggestions from `availableFields` while
                still allowing custom (free-text) field names. Enter on the
                input adds the current value (whether it came from a listbox
                pick or was typed manually), so cross-links remain valid even
                when the stream schema doesn't list a given field yet.
              -->
              <OCombobox
                v-if="availableFields.length > 0"
                ref="fieldComboboxRef"
                v-model="newFieldName"
                class="tw:flex-1"
                :items="availableFieldOptions"
                :placeholder="t('crossLinks.fieldInputPlaceholder')"
                @select="onFieldSelect"
                data-test="cross-link-field-input"
              />
              <OInput
                v-else
                v-model="newFieldName"
                class="tw:flex-1"
                :placeholder="t('crossLinks.fieldInputPlaceholder')"
                data-test="cross-link-field-input"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="add"
                @click="addField"
                :disabled="!newFieldName"
                data-test="cross-link-add-field-btn"
              />
            </div>
          </div>
        </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import CrossLinkUserGuide from "./CrossLinkUserGuide.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
}

export default defineComponent({
  name: "CrossLinkDialog",
  components: { CrossLinkUserGuide, OBadge, OButton, OCombobox, ODialog, OIcon, OInput },
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

    const nameError = ref("");
    const urlError = ref("");
    const isEditing = computed(() => !!props.link?.name);
    const newFieldName = ref("");
    // Template ref to OCombobox so we can call its imperative `clear()` after
    // every commit (Add / Enter / select). The v-model path alone is
    // unreliable because reka-ui's internal search-term state survives
    // synchronous v-model round-trips when the parent clears in the same tick.
    const fieldComboboxRef = ref<{ clear: () => Promise<void> } | null>(null);

    const form = ref({
      name: "",
      url: "",
      fields: [] as Array<{ name: string }>,
    });

    function clearFieldInput() {
      // Reset the v-model AND call OCombobox's imperative `clear()`. The
      // v-model write alone is insufficient because Vue's pre-flush watcher
      // dedupes synchronous "" → value → "" round-trips (they look like a
      // no-op), and reka-ui keeps an internal search-term state that survives
      // the v-model reset. The exposed clear() resets both layers together.
      newFieldName.value = "";
      fieldComboboxRef.value?.clear();
    }

    function addField() {
      const name = (newFieldName.value || "").trim();
      if (name && !form.value.fields.some((f) => f.name === name)) {
        form.value.fields.push({ name });
      }
      clearFieldInput();
    }

    // Suggestion options shown by the OCombobox. We filter out fields that
    // have already been added so the dropdown only suggests remaining
    // schema columns; custom (free-text) values are still accepted via the
    // OCombobox input + Enter / Add button.
    const availableFieldOptions = computed(() => {
      const added = new Set(form.value.fields.map((f) => f.name));
      return (props.availableFields || [])
        .filter((name) => !added.has(name))
        .map((name) => ({ label: name, value: name }));
    });

    function onFieldSelect(value: string) {
      // Selecting from the suggestions list should commit the field
      // immediately; the typed value is already synced via v-model.
      newFieldName.value = value;
      addField();
    }

    // Enter on the wrapper bubbles up from OCombobox's internal input.
    // reka-ui's Combobox handles Enter to commit the highlighted item to
    // v-model first; by the time this fires `newFieldName.value` is the
    // selected / typed text, so addField() picks up the correct value.
    function onFieldKeydown(event: KeyboardEvent) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      // Defer to the next microtask so reka-ui's update:model-value has
      // a chance to land before we read newFieldName.value.
      queueMicrotask(() => addField());
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
      nameError.value = !form.value.name ? t('crossLinks.nameRequired') : '';
      urlError.value = !form.value.url ? t('crossLinks.urlRequired') : '';
      if (nameError.value || urlError.value) return;
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
      nameError,
      urlError,
      form,
      newFieldName,
      fieldComboboxRef,
      availableFieldOptions,
      addField,
      onFieldSelect,
      onFieldKeydown,
      onSubmit,
      onCancel,
    };
  },
});
</script>
