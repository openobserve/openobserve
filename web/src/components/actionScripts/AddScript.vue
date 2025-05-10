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
  <div data-test="add-script-container" class="full-height">
    <!-- Header -->
    <div class="row items-center justify-between no-wrap q-px-md q-py-sm">
      <div class="text-h6" data-test="add-script-title">
        {{ t("actions.add") }}
      </div>
      <q-icon
        data-test="add-role-close-dialog-btn"
        name="cancel"
        class="cursor-pointer"
        size="20px"
        @click="emit('cancel:hideform')"
      />
    </div>
    <q-separator />

    <!-- Form Content -->
    <div class="q-pa-md flex-grow-1 overflow-auto">
      <q-form class="q-gutter-md" ref="addScriptFormRef" @submit="saveScript">
        <div data-test="add-script-name-input" class="o2-input q-px-sm">
          <q-input
            v-model.trim="formData.name"
            :label="t('alerts.name') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[
              (val) =>
                !!val
                  ? isValidResourceName(val) ||
                    `Characters like :, ?, /, #, and spaces are not allowed.`
                  : t('common.nameRequired'),
            ]"
            tabindex="0"
          >
            <template v-slot:hint>
              Characters like :, ?, /, #, and spaces are not allowed.
            </template>
          </q-input>
        </div>

        <div data-test="add-script-description-input" class="q-px-sm">
          <q-input
            v-model="formData.description"
            :label="t('reports.description')"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            type="textarea"
            rows="2"
            tabindex="0"
          />
        </div>
      </q-form>
    </div>

    <!-- Footer with buttons -->
    <div class="flex justify-center q-px-md q-pb-md q-pt-lg">
      <q-btn
        data-test="add-script-cancel-btn"
        class="text-bold"
        :label="t('alerts.cancel')"
        text-color="light-text"
        padding="sm md"
        no-caps
        @click="emit('cancel:hideform')"
      />
      <q-btn
        data-test="add-script-save-btn"
        :label="t('alerts.save')"
        class="text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        no-caps
        :loading="isSaving"
        @click="saveScript"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import actions from "@/services/action_scripts";
import { isValidResourceName } from "@/utils/zincutils";

const { t } = useI18n();
const router = useRouter();
const store = useStore();
const $q = useQuasar();

const emit = defineEmits(["update:list", "cancel:hideform"]);

// Form reference and data
const addScriptFormRef = ref(null);
const formData = ref({
  name: "",
  description: "",
});
const isSaving = ref(false);

// Watch for route changes to reset form
watch(
  () => router.currentRoute.value.query.action,
  (newAction) => {
    if (newAction === "add") {
      resetForm();
    }
  },
);

// Reset form to initial state
const resetForm = () => {
  formData.value = {
    name: "",
    description: "",
  };
};

// Save the action script
const saveScript = async () => {
  // Validate the form
  const isValid = await addScriptFormRef.value.validate();
  if (!isValid) return;

  isSaving.value = true;

  const dismiss = $q.notify({
    spinner: true,
    message: "Creating action script...",
  });

  try {
    // Create initial action data
    const actionData = {
      name: formData.value.name,
      description: formData.value.description,
      owner: store.state.userInfo.email,
    };

    // Save to backend
    const response = await actions.create(
      store.state.selectedOrganization.identifier,
      "",
      actionData,
    );

    dismiss();

    $q.notify({
      type: "positive",
      message: "Action script created successfully",
      timeout: 2000,
    });

    // Reset form and close drawer
    resetForm();

    // Redirect to edit page
    router.push({
      name: "actionScripts",
      query: {
        action: "update",
        id: response.data.id,
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });

    // Emit event to refresh the list
    emit("update:list");
  } catch (error) {
    dismiss();
    console.error("Error saving action script:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.message || "Error creating action script",
      timeout: 3000,
    });
  } finally {
    isSaving.value = false;
  }
};
</script>

<style lang="scss" scoped>
.o2-input {
  margin-bottom: 16px;
}
</style>
