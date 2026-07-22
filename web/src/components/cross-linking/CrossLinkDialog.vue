<template>
  <ODialog
    data-test="cross-link-dialog"
    v-model:open="dialogVisible"
    persistent
    size="md"
    :show-close="false"
    form-id="cross-link-form"
    :title="isEditing ? t('crossLinks.editCrossLink') : t('crossLinks.addCrossLink')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('crossLinks.update') : t('crossLinks.add')"
    @click:secondary="onCancel"
  >
    <template #header-right>
      <CrossLinkUserGuide />
    </template>
    <OForm id="cross-link-form" :form="form">
      <!-- Name -->
      <div class="mb-3">
        <OFormInput
          name="name"
          :label="t('crossLinks.name')"
          required
          :placeholder="t('crossLinks.namePlaceholder')"
          data-test="cross-link-name-input"
        />
      </div>

      <!-- URL Template -->
      <div class="mb-3">
        <OFormInput
          name="url"
          :label="t('crossLinks.urlTemplate')"
          required
          :placeholder="t('crossLinks.urlPlaceholder')"
          data-test="cross-link-url-input"
        />
        <div class="text-xs mt-1 text-text-muted">
          {{ t("crossLinks.urlHint") }}
        </div>
      </div>

      <!-- Fields -->
      <div class="mb-2">
        <label class="block text-sm font-semibold mb-1 text-text-heading">{{
          t("crossLinks.fields")
        }}</label>
        <div class="text-xs mb-2 text-text-muted">
          {{ t("crossLinks.fieldsHint") }}
        </div>
        <div v-if="formFields.length > 0" class="flex flex-wrap gap-1 mb-2">
          <OTag
            v-for="(field, idx) in formFields"
            :key="idx"
            type="selectionChip"
            class="max-w-62.5"
            :data-test="`cross-link-field-chip-${idx}`"
          >
            <span class="truncate text-xs" :title="field.name">{{ field.name }}</span>
            <template #trailing>
              <button
                type="button"
                :aria-label="`Remove ${field.name}`"
                :data-test="`cross-link-field-chip-remove-${idx}`"
                class="inline-flex items-center justify-center cursor-pointer hover:opacity-70"
                @click="removeField(idx)"
              >
                <OIcon name="close" size="xs" />
              </button>
            </template>
          </OTag>
        </div>
        <div class="flex gap-2 items-center" @keydown="onFieldKeydown">
          <!--
                Chip-builder scratch input — now a form-owned `newFieldName`
                field (R1-strict: no bare control inside the OForm). The
                committed chips live in the form-owned `fields` array (bridged
                from `fieldsModel`). OFormCombobox provides suggestions from
                `availableFields` while still allowing custom (free-text) names;
                the OFormInput is the fallback when no suggestions exist.
              -->
          <OFormCombobox
            v-if="availableFields.length > 0"
            ref="fieldComboboxRef"
            name="newFieldName"
            class="flex-1"
            :items="availableFieldOptions"
            :placeholder="t('crossLinks.fieldInputPlaceholder')"
            @select="onFieldSelect"
            data-test="cross-link-field-input"
          />
          <OFormInput
            v-else
            name="newFieldName"
            class="flex-1"
            :placeholder="t('crossLinks.fieldInputPlaceholder')"
            data-test="cross-link-field-input"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="add"
            @click="addField"
            data-test="cross-link-add-field-btn"
          />
        </div>
      </div>
    </OForm>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import CrossLinkUserGuide from "./CrossLinkUserGuide.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { makeCrossLinkDialogSchema, type CrossLinkDialogForm } from "./CrossLinkDialog.schema";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
}

export default defineComponent({
  name: "CrossLinkDialog",
  components: {
    CrossLinkUserGuide,
    OTag,
    OButton,
    OFormCombobox,
    ODialog,
    OForm,
    OFormInput,
    OIcon,
  },
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

    const crossLinkDialogSchema = makeCrossLinkDialogSchema(t);
    const isEditing = computed(() => !!props.link?.name);
    // Template ref to the OFormCombobox so we can call its forwarded imperative
    // `clear()` after every commit (Add / Enter / select) — needed because
    // reka-ui keeps an internal search-term state that survives a model reset.
    const fieldComboboxRef = ref<{ clear: () => void } | null>(null);

    // Dynamic (edit-prefill) defaults → a typed component computed. Seeds
    // name/url/fields/newFieldName from the current `link`; re-applied on open
    // via form.reset (the form is created here, so it persists across opens).
    const crossLinkDefaults = computed(
      (): CrossLinkDialogForm => ({
        name: props.link?.name ?? "",
        url: props.link?.url ?? "",
        fields: props.link?.fields ? props.link.fields.map((f) => ({ name: f.name })) : [],
        newFieldName: "",
      }),
    );

    // Owner-pattern form (Rule ③): CrossLinkDialog OWNS the <OForm> and its
    // template renders the chip list from the form-owned `fields` array. We
    // create the form here with useOForm and read `fields` reactively via
    // form.useStore — ONE source of truth (no `fieldsModel` mirror / watch→
    // setFieldValue bridge). The chip handlers write `fields` THROUGH the form.
    const form = useOForm<CrossLinkDialogForm>({
      defaultValues: crossLinkDefaults.value,
      schema: crossLinkDialogSchema,
      onSubmit,
    });

    // Reactive read-only view of the form-owned `fields` array (NOT a copy).
    // useOForm keeps the form's TFormData generic, so cast the loose reads to
    // the schema shape.
    const formFields = form.useStore(
      (s) => (s.values.fields as Array<{ name: string }> | undefined) ?? [],
    );

    // Typed snapshot read of the form-owned `fields` array (for handlers).
    const currentFields = (): Array<{ name: string }> =>
      (form.state.values.fields as Array<{ name: string }> | undefined) ?? [];

    const currentNewFieldName = (): string => (form.state.values?.newFieldName ?? "") as string;

    function clearFieldInput() {
      // OFormCombobox path: clear() resets reka-ui's internal search text AND
      // emits update:model-value "" → the form's `newFieldName` field clears
      // too (the model write alone is insufficient — reka-ui keeps a separate
      // search-term state that survives it).
      const combobox = fieldComboboxRef.value;
      if (combobox?.clear) {
        combobox.clear();
      } else {
        // OFormInput fallback (no suggestions) → just clear the form field.
        form.setFieldValue("newFieldName", "");
      }
    }

    // Commit a staged field name as a chip (dedup + non-empty) by writing it
    // INTO the form-owned `fields` array, then reset the scratch input.
    function commitField(rawName: string) {
      const name = (rawName || "").trim();
      const current = currentFields();
      if (name && !current.some((f) => f.name === name)) {
        form.setFieldValue("fields", [...current, { name }]);
      }
      clearFieldInput();
    }

    function addField() {
      commitField(currentNewFieldName());
    }

    function removeField(idx: number) {
      form.setFieldValue(
        "fields",
        currentFields().filter((_, i) => i !== idx),
      );
    }

    // Suggestion options shown by the OFormCombobox. We filter out fields that
    // have already been added so the dropdown only suggests remaining
    // schema columns; custom (free-text) values are still accepted via the
    // combobox input + Enter / Add button.
    const availableFieldOptions = computed(() => {
      const added = new Set((formFields.value ?? []).map((f) => f.name));
      return (props.availableFields || [])
        .filter((name) => !added.has(name))
        .map((name) => ({ label: name, value: name }));
    });

    function onFieldSelect(value: string) {
      // Selecting from the suggestions list commits the picked value directly.
      commitField(value);
    }

    // Enter on the wrapper bubbles up from the combobox's internal input.
    // reka-ui commits the highlighted/typed text to the form field first; defer
    // a microtask so that update has landed before addField() reads it.
    function onFieldKeydown(event: KeyboardEvent) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      queueMicrotask(() => addField());
    }

    // Re-seed the form on open. The form is created in setup() (owner pattern),
    // so it persists across the dialog body's unmount/remount — reset it from
    // the current `link` whenever the dialog opens.
    watch(
      () => props.modelValue,
      (visible) => {
        if (visible) form.reset(crossLinkDefaults.value);
      },
    );

    // onSubmit fires only once the schema passes (name + url required), so the
    // old imperative nameError/urlError guard is gone. name/url come from the
    // validated `value`; `fields` is read from the form after committing any
    // field the user typed but didn't add with +.
    function onSubmit(value: CrossLinkDialogForm) {
      addField();
      emit("save", {
        name: value.name,
        url: value.url,
        fields: currentFields().map((f) => ({ name: f.name })),
      });
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
      // The form is created in setup() and handed to <OForm :form="form">.
      form,
      formFields,
      fieldComboboxRef,
      availableFieldOptions,
      addField,
      removeField,
      onFieldSelect,
      onFieldKeydown,
      onCancel,
    };
  },
});
</script>
