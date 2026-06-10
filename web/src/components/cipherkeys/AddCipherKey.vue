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
  <div class="tw:rounded-md tw:p-0" style="min-height: inherit;">
    <AppPageHeader
      :back="{
        label: t('cipherKey.header'),
        onClick: () => emit('cancel:hideform'),
      }"
      class="tw:px-3 tw:border-b tw:border-border-default"
    >
      <template #title>
        <span data-test="add-template-title">
          {{ isUpdatingCipherKey ? t("cipherKey.update") : t("cipherKey.add") }}
        </span>
      </template>
    </AppPageHeader>
    <div
      class="create-cipher-form"
    >
    <div style="height: calc(100vh -  var(--navbar-height) - 155px); overflow: auto">
      <!-- Constrain the whole form to a sensible reading width on wide screens
           while staying fluid below the breakpoint. Uses Tailwind's design-system
           max-width token (max-w-3xl ≈ 48rem) instead of arbitrary px values. -->
      <div class="tw:w-full tw:max-w-3xl">
      <div class="tw:flex">
        <div class="tw:w-1/3 o2-input tw:flex tw:mx-3 tw:mt-3 tw:mb-4">
          <OInput
            data-test="add-cipher-key-name-input"
            v-model="formData.name"
            :label="t('cipherKey.name') + ' *'"
            class="tw:w-full"
            v-bind:readonly="isUpdatingCipherKey"
            v-bind:disable="isUpdatingCipherKey"
            :error="!!nameError"
            :error-message="nameError"
            @update:model-value="validateName()"
            @blur="validateName()"
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
        class="tw:mx-3 tw:p-0 tw:h-full"
      >
        <OStep
          data-test="cipher-key-key-store-detils-step"
          :name="1"
          :title="
            t('cipherKey.step1') +
            ' (Type: ' +
            getTypeLabel(formData.key.store.type) +
            ')'
          "
          icon="edit"
          :done="step > 1"
        >
          <div>
            <div class="tw:w-full">
              <OSelect
                data-test="add-cipher-key-type-input"
                v-model="formData.key.store.type"
                :label="t('cipherKey.type') + ' *'"
                class="tw:w-full"
                :options="cipherKeyTypes"
                labelKey="label"
                valueKey="value"
                :error="!!storeTypeError"
                :error-message="storeTypeError"
                @update:model-value="storeTypeError = ''"
                tabindex="0"
              />
            </div>
            <add-openobserve-type
              v-if="formData.key.store.type == 'local'"
              class="tw:mt-2"
              :submitAttempted="submitAttempted"
              v-model:formData="formData"
            />
            <add-akeyless-type
              v-else-if="formData.key.store.type == 'akeyless'"
              ref="akeylessTypeRef"
              class="tw:mt-2"
              v-model:formData="formData"
            />
            <div class="tw:flex tw:gap-2 tw:mt-4">
              <OButton
                data-test="add-report-step1-continue-btn"
                variant="primary"
                size="sm-action"
                @click="validateForm(2)"
              >
                Continue
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
          <add-encryption-mechanism ref="encryptionMechanismRef" v-model:formData="formData" />
          <div class="tw:flex tw:gap-2 tw:mt-4">
            <OButton
              data-test="add-cipher-key-step2-back-btn"
              variant="outline"
              size="sm-action"
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
    <div class="tw:mx-2">
            <div class="tw:flex tw:justify-end tw:px-2 tw:py-4 tw:w-full tw:gap-2 tw:border-t tw:border-border-default"
      style="position: sticky; bottom: 0px; z-index: 2"
      >
        <OButton
          data-test="add-cipher-key-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="openCancelDialog"
        >
          {{ t('common.cancel') }}
        </OButton>
        <OButton
          :disabled="
            (step === 1 && isUpdatingCipherKey == false) || isSubmitting
          "
          data-test="add-cipher-key-save-btn"
          variant="primary"
          size="sm-action"
          @click="onSubmit"
        >
          {{ t('common.save') }}
        </OButton>
      </div>
    </div>
    </div>
    <ConfirmDialog
      v-model="dialog.show"
      :title="dialog.title"
      :message="dialog.message"
      @update:ok="dialog.okCallback"
      @update:cancel="dialog.show = false"
    />
  </div>
</template>
<script lang="ts" setup>
import { ref, onBeforeMount, onActivated, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import {
  isValidResourceName,
  maxLengthCharValidation,
} from "@/utils/zincutils";
import AddOpenobserveType from "@/components/cipherkeys/AddOpenobserveType.vue";
import AddAkeylessType from "@/components/cipherkeys/AddAkeylessType.vue";
import AddEncryptionMechanism from "@/components/cipherkeys/AddEncryptionMechanism.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CipherKeysService from "@/services/cipher_keys";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

const emit = defineEmits(["cancel:hideform"]);
const { t } = useI18n();
const router = useRouter();
const store = useStore();
const addCipherKeyFormRef: any = ref();
const nameError = ref('');
const storeTypeError = ref('');
// Flipped to true the first time the user clicks Continue. Passed down to
// sub-forms so they can surface "X is required" errors on un-touched fields.
const submitAttempted = ref(false);
const isUpdatingCipherKey: any = ref(false);
const step = ref(1);
const isSubmitting = ref(false);
const formData: any = ref({
  name: "",
  key: {
    store: {
      type: "local",
      akeyless: {
        base_url: "",
        access_id: "",
        auth: {
          type: "access_key",
          access_key: "",
          ldap: {
            username: "",
            password: "",
          },
        },
        store: {
          type: "static_secret",
          static_secret: "",
          dfc: {
            name: "",
            iv: "",
            encrypted_data: "",
          },
        },
      },
      local: "",
    },
    mechanism: {
      type: "simple",
      simple_algorithm: "aes-256-siv",
    },
  },
});
const cipherKeyTypes = computed(() => [
  { label: "OpenObserve", value: "local" },
  { label: "Akeyless", value: "akeyless" },
]);

const originalData: any = ref("");

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

onActivated(() => setupTemplateData());
onBeforeMount(() => {
  formData.value["isUpdate"] = isUpdatingCipherKey;
  originalData.value = JSON.stringify(formData.value);
  setupTemplateData();
});

const getTypeLabel = (type: string) => {
  return cipherKeyTypes.value.find((t) => t.value === type)?.label;
};

function mergeObjects(base: any, updates: any) {
  for (const key in updates) {
    if (
      updates[key] !== null &&
      typeof updates[key] === "object" &&
      !Array.isArray(updates[key])
    ) {
      // If the value is an object, recursively merge
      base[key] = mergeObjects(base[key] || {}, updates[key]);
    } else {
      // Otherwise, replace or add the value from updates
      base[key] = updates[key];
    }
  }
  return base;
}

const setupTemplateData = () => {
  if (router.currentRoute.value.query.action === "edit") {
    isUpdatingCipherKey.value = true;
    if (router.currentRoute.value.query.name) {
      const name = String(router.currentRoute.value.query.name) || "";
      if (name === "") {
        toast({
          variant: "error",
          message: "Invalid cipher key name",
        });
        emit("cancel:hideform");
        return;
      }
      CipherKeysService.get_by_name(
        store.state.selectedOrganization.identifier,
        name,
      )
        .then((response) => {
          formData.value = mergeObjects({ ...formData.value }, response.data);
          originalData.value = JSON.stringify(formData.value);
        })
        .catch((error) => {
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response.data.message || "Error fetching cipher key.",
            });
          }
        });
    }
  }
};

const validateName = (): boolean => {
  if (!formData.value.name) {
    nameError.value = 'Name is required';
    return false;
  }
  if (!isValidResourceName(formData.value.name)) {
    nameError.value = 'Characters like :, ?, /, #, and spaces are not allowed.';
    return false;
  }
  if (formData.value.name.length > 50) {
    nameError.value = 'Name must be 50 characters or less.';
    return false;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(formData.value.name)) {
    nameError.value = 'Only alphanumeric characters, underscores, and hyphens are allowed';
    return false;
  }
  nameError.value = '';
  return true;
};

const validateStoreType = (): boolean => {
  if (!formData.value.key.store.type) {
    storeTypeError.value = 'Type is required';
    return false;
  }
  storeTypeError.value = '';
  return true;
};

const onSubmit = () => {
  const nameValid = validateName();
  const typeValid = validateStoreType();
  const mechanismValid = encryptionMechanismRef.value?.validate?.() ?? true;
  if (!nameValid || !typeValid || !mechanismValid) {
    toast({ variant: "error", message: 'Please fill all the required fields' });
    return;
  }
  isSubmitting.value = true;
  if (isUpdatingCipherKey.value) {
    isSubmitting.value = false;
    updateCipherKey();
  } else {
    isSubmitting.value = false;
    createCipherKey();
  }
};

const createCipherKey = () => {
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while processing your request...",
      timeout: 0,
});
  CipherKeysService.create(
    store.state.selectedOrganization.identifier,
    formData.value,
  )
    .then((response) => {
      dismiss();
      toast({
        variant: "success",
        message: "Cipher key created successfully",
      });
      emit("cancel:hideform");
    })
    .catch((error) => {
      dismiss();
      if (error.status != 403) {
        toast({
          variant: "error",
          message: error.response.data.message,
        });
      }
    });
};

function filterEditedAttributes(formdata: any, originalData: any) {
  const result: any = {};

  for (const key in formdata) {
    const formValue = formdata[key];
    const originalValue = originalData[key];

    if (originalValue === undefined) {
      // New attribute in formdata, keep it
      result[key] = formValue;
    } else if (
      typeof formValue === "object" &&
      formValue !== null &&
      !Array.isArray(formValue)
    ) {
      // Recursively process nested objects
      const nestedResult = filterEditedAttributes(formValue, originalValue);
      if (Object.keys(nestedResult).length > 0) {
        result[key] = nestedResult;
      }
    } else if (formValue !== originalValue) {
      // Edited attribute, keep it
      result[key] = formValue;
    }
  }

  return result;
}

const updateCipherKey = () => {
  isSubmitting.value = true;
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while processing your request...",
      timeout: 0,
});

  if (JSON.stringify(formData.value) == originalData.value) {
    dismiss();
    toast({
      variant: "success",
      message: "No changes detected",
    });
    emit("cancel:hideform");
    return;
  }

  const editedData = filterEditedAttributes(
    formData.value,
    JSON.parse(originalData.value),
  );

  CipherKeysService.update(
    store.state.selectedOrganization.identifier,
    formData.value,
    formData.value.name,
  )
    .then((response) => {
      isSubmitting.value = false;
      dismiss();
      toast({
        variant: "success",
        message: "Cipher key updated successfully",
      });
      emit("cancel:hideform");
    })
    .catch((error) => {
      isSubmitting.value = false;
      dismiss();
      if (error.status != 403) {
        toast({
          variant: "error",
          message: error.response.data.message,
        });
      }
    });
};

const openCancelDialog = () => {
  if (originalData.value === JSON.stringify(formData.value)) {
    goToCipherList();
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = goToCipherList;
};

const goToCipherList = () => {
  emit("cancel:hideform");
};

// Template ref to the Akeyless sub-form so we can call its exposed
// `validate()` method (which runs all field validators and sets the
// inline error refs).
const akeylessTypeRef = ref<any>(null);
const encryptionMechanismRef = ref<any>(null);

const validateStoreSecret = (): boolean => {
  const type = formData.value.key.store.type;
  if (type === 'local') {
    const secret = formData.value.key.store.local;
    if (!secret || (typeof secret === 'string' && secret.trim() === '')) {
      return false;
    }
  }
  if (type === 'akeyless') {
    // Returns false if any required Akeyless field is missing; the child has
    // already surfaced inline errors for whichever fields failed.
    const ok = akeylessTypeRef.value?.validate?.();
    if (ok === false) return false;
  }
  return true;
};

const validateForm = async (stepNumber: number) => {
  // Flip submitAttempted so child sub-forms surface their inline errors on
  // un-touched fields. Then run every validator (no short-circuit) so all
  // missing fields show their errors at once.
  submitAttempted.value = true;
  const nameValid = validateName();
  const typeValid = validateStoreType();
  const secretValid = validateStoreSecret();
  if (nameValid && typeValid && secretValid) {
    step.value = stepNumber;
  }
};
</script>
