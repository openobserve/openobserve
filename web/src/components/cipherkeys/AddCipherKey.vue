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
  <q-page class="q-pa-none" style="min-height: inherit;">
    <div class="row items-center no-wrap q-mx-md q-pt-sm">
      <div class="flex items-center tw:py-2">
        <div
          no-caps
            padding="xs"
            outline
            icon="arrow_back_ios_new"
            class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
          title="Go Back"
          @click="$emit('cancel:hideform')"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div class="col" data-test="add-template-title">
          <div v-if="isUpdatingCipherKey" class="text-h6">
            {{ t("cipherKey.update") }}
          </div>
          <div v-else class="text-h6">
            {{ t("cipherKey.add") }}
          </div>
        </div>
      </div>
    </div>
    <q-separator />
    <q-form
      class="create-cipher-form"
      ref="addCipherKeyFormRef"
      @submit="onSubmit"
    >
    <div style="height: calc(100vh - 180px); overflow: auto">
      <div class="row">
        <div class="col-4 o2-input flex q-mx-md q-mt-md">
          <q-input
            data-test="add-cipher-key-name-input"
            v-model="formData.name"
            :label="t('cipherKey.name') + ' *'"
            class="showLabelOnTop full-width"
            stack-label
            borderless
            dense
            v-bind:readonly="isUpdatingCipherKey"
            v-bind:disable="isUpdatingCipherKey"
            :rules="[
              (val: any) =>
                !!val
                  ? isValidResourceName(val) ||
                    `Characters like :, ?, /, #, and spaces are not allowed.`
                  : 'Name is required',
              (val: any) => maxLengthCharValidation(val, 50),
              (val: any) =>
                /^[a-zA-Z0-9_-]+$/.test(val) ||
                'Only alphanumeric characters, underscores, and hyphens are allowed',
            ]"
            tabindex="0"
          />
        </div>
      </div>

      <q-stepper
        v-model="step"
        vertical
        color="primary"
        animated
        class="q-mx-md q-pa-none"
        header-nav
      >
        <q-step
          data-test="cipher-key-key-store-detils-step"
          :name="1"
          :title="
            t('cipherKey.step1') +
            ' (Type: ' +
            getTypeLabel(formData.key.store.type) +
            ')'
          "
          icon="addition"
          :done="step > 1"
        >
          <div>
            <div class="q-w-lg">
              <q-select
                data-test="add-cipher-key-type-input"
                v-model="formData.key.store.type"
                :label="t('cipherKey.type') + ' *'"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop full-width"
                stack-label
                dense
                borderless
                hide-bottom-space
                :options="cipherKeyTypes"
                option-value="value"
                option-label="label"
                map-options
                emit-value
                :rules="[(val: any) => !!val || 'Type is required']"
                tabindex="0"
              />
            </div>
            <add-openobserve-type
              v-if="formData.key.store.type == 'local'"
              v-model:formData="formData"
            />
            <add-akeyless-type
              v-else-if="formData.key.store.type == 'akeyless'"
              v-model:formData="formData"
            />
          </div>
          <q-stepper-navigation>
            <q-btn
              data-test="add-report-step1-continue-btn"
              @click="validateForm(2)"
              class="o2-primary-button tw:h-[36px]"
              flat
              no-caps
              :label="'Continue'"
            />
          </q-stepper-navigation>
        </q-step>

        <q-step
          data-test="cipher-key-encryption-mechanism-step"
          :name="2"
          :title="t('cipherKey.step2')"
          icon="addition"
          :done="step > 2"
        >
          <add-encryption-mechanism v-model:formData="formData" />
          <q-stepper-navigation class="q-pa-none">
            <q-btn
              data-test="add-cipher-key-step2-back-btn"
              flat
              @click="step = 1"
              class="o2-secondary-button tw:h-[36px] q-mb-sm"
              :label="t('common.back')"
              no-caps
            />
          </q-stepper-navigation>
        </q-step>
      </q-stepper>
    </div>
    <div class="tw:mx-2">
            <div class="flex justify-end q-px-sm q-py-lg full-width"
      style="position: sticky; bottom: 0px; z-index: 2"
      >
        <q-btn
          data-test="add-cipher-key-cancel-btn"
          class="q-mr-md o2-secondary-button tw:h-[36px]"
          :label="t('common.cancel')"
          no-caps
          flat
          @click="openCancelDialog"
        />
        <q-btn
          :disable="
            (step === 1 && isUpdatingCipherKey == false) || isSubmitting
          "
          data-test="add-cipher-key-save-btn"
          class="o2-primary-button no-border tw:h-[36px]"
          :label="t('common.save')"
          type="submit"
          no-caps
          flat
        />
      </div>
    </div>
    </q-form>
    <ConfirmDialog
      v-model="dialog.show"
      :title="dialog.title"
      :message="dialog.message"
      @update:ok="dialog.okCallback"
      @update:cancel="dialog.show = false"
    />
  </q-page>
</template>
<script lang="ts" setup>
import { ref, onBeforeMount, onActivated, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import {
  isValidResourceName,
  maxLengthCharValidation,
} from "@/utils/zincutils";
import AddOpenobserveType from "@/components/cipherkeys/AddOpenobserveType.vue";
import AddAkeylessType from "@/components/cipherkeys/AddAkeylessType.vue";
import AddEncryptionMechanism from "@/components/cipherkeys/AddEncryptionMechanism.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CipherKeysService from "@/services/cipher_keys";

const emit = defineEmits(["cancel:hideform"]);
const { t } = useI18n();
const router = useRouter();
const $q = useQuasar();
const store = useStore();
const addCipherKeyFormRef: any = ref();
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
        $q.notify({
          type: "negative",
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
            $q.notify({
              type: "negative",
              message:
                error.response.data.message || "Error fetching cipher key.",
            });
          }
        });
    }
  }
};

const onSubmit = () => {
  isSubmitting.value = true;
  addCipherKeyFormRef.value
    .validate()
    .then((valid: any) => {
      isSubmitting.value = false;
      if (isUpdatingCipherKey.value) {
        updateCipherKey();
      } else {
        createCipherKey();
      }
    })
    .catch((error: any) => {
      isSubmitting.value = false;
      if (error?.status != 403) {
        $q.notify({
          type: "negative",
          message: "Please fill all the required fields",
        });
      }
    });
};

const createCipherKey = () => {
  const dismiss = $q.notify({
    spinner: true,
    message: "Please wait while processing your request...",
  });
  CipherKeysService.create(
    store.state.selectedOrganization.identifier,
    formData.value,
  )
    .then((response) => {
      dismiss();
      $q.notify({
        type: "positive",
        message: "Cipher key created successfully",
      });
      emit("cancel:hideform");
    })
    .catch((error) => {
      dismiss();
      if (error.status != 403) {
        $q.notify({
          type: "negative",
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
  const dismiss = $q.notify({
    spinner: true,
    message: "Please wait while processing your request...",
  });

  if (JSON.stringify(formData.value) == originalData.value) {
    dismiss();
    $q.notify({
      type: "positive",
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
      $q.notify({
        type: "positive",
        message: "Cipher key updated successfully",
      });
      emit("cancel:hideform");
    })
    .catch((error) => {
      isSubmitting.value = false;
      dismiss();
      if (error.status != 403) {
        $q.notify({
          type: "negative",
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

const validateForm = async (stepNumber: number) => {
  // Validate form and expand steps with errors
  let isValid = await addCipherKeyFormRef.value.validate();

  if (isValid) {
    step.value = stepNumber;
  }
};
</script>
