<!--
Copyright 2026 OpenObserve Inc.

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
  <ODialog
    :open="open"
    size="sm"
    @update:open="$emit('update:open', $event)"
    :title="
      isEdit ? t('synthetics.environments.editTitle') : t('synthetics.environments.createTitle')
    "
    :primary-button-label="isEdit ? t('common.save') : t('common.create')"
    :secondary-button-label="t('common.cancel')"
    form-id="synthetics-environment-form"
    @click:secondary="handleClose"
    data-test="synthetics-environment-form-dialog"
  >
    <OForm
      id="synthetics-environment-form"
      :schema="schema"
      :default-values="defaults"
      @submit="save"
      class="flex flex-col gap-4"
    >
      <!-- The name is the OpenFGA object id every grant is written against, so
           renaming would orphan them. The server refuses; say so before trying. -->
      <OBanner v-if="isEdit" variant="info" data-test="synthetics-environment-rename-note">
        {{ t("synthetics.environments.renameBlocked") }}
      </OBanner>

      <OFormInput
        name="name"
        :label="t('synthetics.environments.name')"
        :placeholder="t('synthetics.environments.namePlaceholder')"
        :disabled="isEdit"
        required
        data-test="synthetics-environment-name-input"
      />
      <OFormTextarea
        name="description"
        :label="t('synthetics.environments.description')"
        data-test="synthetics-environment-description-input"
      />
    </OForm>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import type { PropType } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import { makeSyntheticsEnvironmentFormSchema } from "./SyntheticsVariableForm.schema";

export default defineComponent({
  name: "SyntheticsEnvironmentForm",
  components: { ODialog, OForm, OFormInput, OFormTextarea, OBanner },
  emits: ["close", "update:list", "update:open"],
  props: {
    open: { type: Boolean, default: false },
    isEdit: { type: Boolean, default: false },
    data: { type: Object as PropType<SyntheticsEnvironment | null>, default: null },
  },
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    const schema = computed(() => makeSyntheticsEnvironmentFormSchema(t as (_k: string) => string));
    const defaults = computed(() => ({
      name: props.data?.name ?? "",
      description: props.data?.description ?? "",
    }));

    function handleClose() {
      emit("update:open", false);
      emit("close");
    }

    async function save(values: Record<string, unknown>) {
      const org = store.state.selectedOrganization.identifier;
      const body = {
        name: String(values.name ?? ""),
        description: String(values.description ?? ""),
      };
      try {
        await (props.isEdit
          ? syntheticsService.updateEnvironment(org, props.data?.name ?? "", body)
          : syntheticsService.createEnvironment(org, body));
        // Emit and close BEFORE the toast, for the same reason as the variable
        // form: nothing cosmetic should sit between a completed save and the
        // refresh that makes it visible.
        emit("update:list");
        handleClose();
        toast({
          variant: "success",
          message: props.isEdit
            ? t("synthetics.environments.updated")
            : t("synthetics.environments.created"),
        });
      } catch (error: any) {
        toast({
          variant: "error",
          message: error?.response?.data?.message || t("synthetics.environments.saveFailed"),
        });
      }
    }

    return { t, schema, defaults, handleClose, save };
  },
});
</script>
