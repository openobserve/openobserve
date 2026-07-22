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
  <ODialog
    data-test="update-role-dialog"
    :open="open"
    size="sm"
    :title="t('user.editUser')"
    persistent
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <OForm
        id="update-role-form"
        :schema="updateRoleSchema"
        :default-values="updateRoleDefaults"
        @submit="onSubmit"
        v-slot="{ isSubmitting }"
      >
        <OFormInput
          name="first_name"
          :label="t('user.name')"
          class="py-3 showLabelOnTop"
          readonly
        />

        <OFormSelect
          name="role"
          :label="t('user.role')"
          :options="roleOptions"
          required
          class="pt-3 pb-2 showLabelOnTop"
          data-test="iam-update-role-select"
        />

        <div class="flex justify-center mt-4 gap-2">
          <OButton
            @click="$emit('update:open', false)"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            data-test="iam-update-role-cancel-btn"
          >
            {{ t("user.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
            data-test="iam-update-role-save-btn"
          >
            {{ t("user.save") }}
          </OButton>
        </div>
      </OForm>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import organizationsService from "@/services/organizations";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeUpdateRoleSchema, type UpdateRoleForm } from "./UpdateRole.schema";

const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "",
    first_name: "",
    email: "",
  };
};

export default defineComponent({
  name: "ComponentUpdateUser",
  components: { OButton, ODialog, OForm, OFormInput, OFormSelect },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  emits: ["update:modelValue", "updated", "finish", "update:open"],
  setup(props) {
    const store: any = useStore();
    const { t } = useI18n();
    const roleOptions = ["admin"];

    const updateRoleSchema = makeUpdateRoleSchema(t);

    // EDIT-prefill: the OForm owns role/first_name; this typed computed seeds them
    // from the externally-provided modelValue each time the dialog body mounts.
    // org_member_id/email stay non-form data (read from modelValue at submit).
    const updateRoleDefaults = computed(
      (): UpdateRoleForm => ({
        role: props.modelValue?.role ?? "",
        first_name: props.modelValue?.first_name ?? "",
      }),
    );

    // Options-API: the schema (and the defaults computed) MUST be returned from
    // setup() — a bare module import is out of the template's scope, so :schema
    // would resolve to undefined and validation would silently no-op.
    return {
      t,
      store,
      roleOptions,
      updateRoleSchema,
      updateRoleDefaults,
    };
  },
  methods: {
    // Plain async @submit handler — fires only after the Zod schema passes
    // (role required), so no manual roleError guard. Awaited by OForm, so the
    // Save button's spinner spans the request.
    async onSubmit(value: UpdateRoleForm) {
      try {
        const res = await organizationsService.update_member_role(
          {
            id: parseInt(this.modelValue?.org_member_id),
            role: value.role,
            organization_id: parseInt(this.store.state.selectedOrganization.id),
          },
          this.store.state.selectedOrganization.identifier,
        );

        if (res?.data?.error_members != null) {
          toast({
            variant: "error",
            message: this.t("iam.updateRole.errorUpdatingMember"),
            timeout: 15000,
          });
        } else {
          toast({
            variant: "success",
            message: this.t("iam.updateRole.memberUpdatedSuccessfully"),
          });
        }

        this.$emit("updated", res?.data);
        this.$emit("update:open", false);
      } catch (err: any) {
        toast({
          variant: "error",
          message: err?.response?.data?.message || this.t("iam.updateRole.errorUpdatingMember"),
        });
      }
    },
  },
});
</script>
