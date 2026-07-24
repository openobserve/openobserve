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
  <OPageLayout
    class="min-h-[inherit]"
    :back="{
      label: t('cipherKey.header'),
      onClick: () => emit('cancel:hideform'),
    }"
    bleed
  >
      <template #title>
        <span data-test="add-template-title">
          {{ isUpdatingCipherKey ? t("cipherKey.update") : t("cipherKey.add") }}
        </span>
      </template>
    <div class="create-cipher-form">
      <!-- One OForm owns every field across the stepper (the children render
           OForm* controls connected by name); a single Zod schema gates the
           whole form. Inline form → the footer Save is type="submit" (Enter
           works natively) and its spinner is form-driven via v-slot. -->
      <OForm :form="form" v-slot="{ isSubmitting }">
        <div class="overflow-auto" style="height: calc(100vh -  var(--navbar-height) - 155px)">
          <!-- Constrain the whole form to a sensible reading width on wide screens
               while staying fluid below the breakpoint. -->
          <div class="w-full max-w-3xl">
            <div class="flex">
              <div class="w-1/3 o2-input flex mx-3 mt-3 mb-4">
                <OFormInput
                  data-test="add-cipher-key-name-input"
                  name="name"
                  :label="t('cipherKey.name')"
                  required
                  class="w-full"
                  :readonly="isUpdatingCipherKey"
                  :disabled="isUpdatingCipherKey"
                  tabindex="0"
                />
              </div>
            </div>

            <div style="height: calc(100vh -  var(--navbar-height) - 300px);">
              <OStepper
                v-model="step"
                orientation="vertical"
                animated
                navigable
                class="mx-3 p-0 h-full"
              >
                <OStep
                  data-test="cipher-key-key-store-detils-step"
                  :name="1"
                  :title="step1Title"
                  icon="edit"
                  :done="step > 1"
                >
                  <div>
                    <div class="w-full">
                      <OFormSelect
                        data-test="add-cipher-key-type-input"
                        name="key.store.type"
                        :label="t('cipherKey.type')"
                        required
                        class="w-full"
                        :options="cipherKeyTypes"
                        labelKey="label"
                        valueKey="value"
                        tabindex="0"
                      />
                    </div>
                    <add-openobserve-type
                      v-if="storeType === 'local'"
                      class="mt-2"
                      :is-update="isUpdatingCipherKey"
                    />
                    <add-akeyless-type
                      v-else-if="storeType === 'akeyless'"
                      class="mt-2"
                      :is-update="isUpdatingCipherKey"
                    />
                    <div class="flex gap-2 mt-4">
                      <OButton
                        data-test="add-report-step1-continue-btn"
                        variant="primary"
                        size="sm-action"
                        :disabled="isSubmitting"
                        @click="continueToStep2"
                      >
                        {{ t('cipherKey.continue') }}
                      </OButton>
                    </div>
                  </div>
                </OStep>

                <OStep
                  data-test="cipher-key-encryption-mechanism-step"
                  :name="2"
                  :title="t('cipherKey.step2')"
                  icon="add"
                  :done="step > 2"
                >
                  <add-encryption-mechanism />
                  <div class="flex gap-2 mt-4">
                    <OButton
                      data-test="add-cipher-key-step2-back-btn"
                      variant="outline"
                      size="sm-action"
                      :disabled="isSubmitting"
                      @click="step = 1"
                    >
                      {{ t('common.back') }}
                    </OButton>
                  </div>
                </OStep>
              </OStepper>
            </div>
          </div>
        </div>
        <div class="mx-2">
          <div class="flex justify-end px-2 py-4 w-full gap-2 border-t border-border-default sticky"
            style="bottom: 0px; z-index: 2"
          >
            <OButton
              data-test="add-cipher-key-cancel-btn"
              variant="outline"
              size="sm-action"
              :disabled="isSubmitting"
              @click="openCancelDialog"
            >
              {{ t('common.cancel') }}
            </OButton>
            <OButton
              data-test="add-cipher-key-save-btn"
              variant="primary"
              size="sm-action"
              type="submit"
              :loading="isSubmitting"
            >
              {{ t('common.save') }}
            </OButton>
          </div>
        </div>
      </OForm>
    </div>
    <ConfirmDialog
      v-model="dialog.show"
      :title="dialog.title"
      :message="dialog.message"
      @update:ok="dialog.okCallback"
      @update:cancel="dialog.show = false"
    />
  </OPageLayout>
</template>
<script lang="ts" setup>
import { ref, computed, onMounted, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import AddOpenobserveType from "@/components/cipherkeys/AddOpenobserveType.vue";
import AddAkeylessType from "@/components/cipherkeys/AddAkeylessType.vue";
import AddEncryptionMechanism from "@/components/cipherkeys/AddEncryptionMechanism.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CipherKeysService from "@/services/cipher_keys";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import {
  makeAddCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "@/components/cipherkeys/AddCipherKey.schema";

const emit = defineEmits(["cancel:hideform"]);
const { t } = useI18n();
const router = useRouter();
const store = useStore();

const isUpdatingCipherKey = ref(false);
const step = ref(1);
// Continue advances the stepper by running a real form submit; this flag tells
// the @submit handler to advance instead of save (footer Save / Enter saves).
const pendingContinue = ref(false);
// JSON snapshot of the form values at load, for the cancel "discard changes"
// prompt and the edit "no changes detected" short-circuit (isUpdate diffing).
const originalData = ref("");

const cipherKeyTypes = [
  { label: "OpenObserve", value: "local" },
  { label: "Akeyless", value: "akeyless" },
];

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const getTypeLabel = (type: string) =>
  cipherKeyTypes.find((item) => item.value === type)?.label;

// The parent OWNS the form (headless useOForm): it renders <OForm>, so it sits
// above the provide boundary and can't inject — yet it needs store.type
// reactively to drive the OStepper's conditional child + the step-1 title.
// useOForm + form.useStore gives that directly; the children inject this SAME
// form via <OForm :form="form">. The save is wired here through useOForm (not
// @submit on the tag) — wrapped lazily so onFormSubmit (declared below)
// resolves at submit time, not at setup.
// Build the schema with useI18n's `t` so validation messages render in the
// active locale.
const addCipherKeySchema = makeAddCipherKeySchema(t);

const form = useOForm<AddCipherKeyForm>({
  defaultValues: addCipherKeyDefaults(),
  schema: addCipherKeySchema,
  onSubmit: (value) => onFormSubmit(value),
});

const storeType = form.useStore(
  (s: any) => s?.values?.key?.store?.type ?? "local",
);

const step1Title = computed(
  () => `${t("cipherKey.step1")} (Type: ${getTypeLabel(storeType.value)})`,
);

// Deep-merge the loaded record onto the default shape so any field the backend
// omits keeps its schema default (used for edit prefill).
function mergeObjects(base: any, updates: any) {
  for (const key in updates) {
    if (
      updates[key] !== null &&
      typeof updates[key] === "object" &&
      !Array.isArray(updates[key])
    ) {
      base[key] = mergeObjects(base[key] || {}, updates[key]);
    } else {
      base[key] = updates[key];
    }
  }
  return base;
}

const setupTemplateData = () => {
  if (router.currentRoute.value.query.action === "edit") {
    isUpdatingCipherKey.value = true;
    const name = String(router.currentRoute.value.query.name || "");
    if (name === "") {
      toast({ variant: "error", message: "Invalid cipher key name" });
      emit("cancel:hideform");
      return;
    }
    CipherKeysService.get_by_name(
      store.state.selectedOrganization.identifier,
      name,
    )
      .then((response) => {
        // :default-values is read once at mount; re-seed via reset now the
        // record has arrived.
        const record = mergeObjects(
          addCipherKeyDefaults(),
          response.data,
        ) as AddCipherKeyForm;
        form.reset(record);
        originalData.value = JSON.stringify(
          form.state.values ?? record,
        );
      })
      .catch((error) => {
        if (error.status != 403) {
          toast({
            variant: "error",
            message:
              error.response?.data?.message || "Error fetching cipher key.",
          });
        }
      });
  }
};

onActivated(() => setupTemplateData());
onMounted(() => {
  // Baseline for the cancel diff; edit mode re-snapshots after the record loads.
  originalData.value = JSON.stringify(
    form.state.values ?? addCipherKeyDefaults(),
  );
  setupTemplateData();
});

// Continue: validate the whole form by submitting through it (reveals any step-1
// errors on the mounted fields); advance only when valid. pendingContinue makes
// the @submit handler advance instead of save.
const continueToStep2 = async () => {
  pendingContinue.value = true;
  try {
    await form.handleSubmit();
  } finally {
    pendingContinue.value = false;
  }
};

// @submit fires only when the whole schema passes. For a Continue submit we just
// advance the stepper; for a footer Save / Enter submit we create or update.
const onFormSubmit = async (value: AddCipherKeyForm) => {
  if (pendingContinue.value) {
    step.value = 2;
    return;
  }
  if (isUpdatingCipherKey.value) {
    await updateCipherKey(value);
  } else {
    await createCipherKey(value);
  }
};

const createCipherKey = async (value: AddCipherKeyForm) => {
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while processing your request...",
    timeout: 0,
  });
  try {
    // The service's CipherKeyData type declares a `provider` field the payload
    // doesn't include; cast to keep the real shape without editing the shared
    // service type.
    // `isUpdate` is a UI flag, not a form field — merged in here outside the
    // schema. The backend ignores it (KeyAddRequest deserializes only `name` +
    // `key`, no deny_unknown_fields).
    await CipherKeysService.create(
      store.state.selectedOrganization.identifier,
      { ...value, isUpdate: isUpdatingCipherKey.value } as any,
    );
    dismiss();
    toast({ variant: "success", message: "Cipher key created successfully" });
    emit("cancel:hideform");
  } catch (error: any) {
    dismiss();
    if (error.status != 403) {
      toast({ variant: "error", message: error.response?.data?.message });
    }
  }
};

const updateCipherKey = async (value: AddCipherKeyForm) => {
  const current = JSON.stringify(form.state.values ?? value);
  if (current === originalData.value) {
    toast({ variant: "success", message: "No changes detected" });
    emit("cancel:hideform");
    return;
  }
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while processing your request...",
    timeout: 0,
  });
  try {
    // Merge the `isUpdate` UI flag into the body (backend ignores it — see
    // createCipherKey).
    await CipherKeysService.update(
      store.state.selectedOrganization.identifier,
      { ...value, isUpdate: isUpdatingCipherKey.value } as any,
      value.name,
    );
    dismiss();
    toast({ variant: "success", message: "Cipher key updated successfully" });
    emit("cancel:hideform");
  } catch (error: any) {
    dismiss();
    if (error.status != 403) {
      toast({ variant: "error", message: error.response?.data?.message });
    }
  }
};

const goToCipherList = () => {
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  const current = JSON.stringify(form.state.values ?? {});
  if (current === originalData.value) {
    goToCipherList();
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = goToCipherList;
};

defineExpose({
  form,
  step,
  isUpdatingCipherKey,
  storeType,
  cipherKeyTypes,
  getTypeLabel,
  dialog,
  continueToStep2,
  openCancelDialog,
});
</script>
