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
  <ODialog data-test="update-role-dialog"
    :open="open"
    size="sm"
    :title="t('user.editUser')"
    persistent
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <div>
        <OInput
          v-model="orgMemberData.first_name"
          :label="t('user.name')"
          class="tw:py-3 showLabelOnTop"
          readonly
        />

        <OSelect
          v-model="orgMemberData.role"
          :label="t('user.role')"
          :options="roleOptions"
          :error="!!roleError"
          :error-message="roleError"
          class="tw:pt-3 tw:pb-2 showLabelOnTop"
          data-test="iam-update-role-select"
          @update:model-value="roleError = ''"
        />

        <div class="tw:flex tw:justify-center tw:mt-4 tw:gap-2">
          <OButton
            @click="$emit('update:open', false)"
            variant="outline"
            size="sm-action"
            data-test="iam-update-role-cancel-btn"
          >
            {{ t('user.cancel') }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            @click="onSubmit"
            data-test="iam-update-role-save-btn"
          >
            {{ t('user.save') }}
          </OButton>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";

import organizationsService from "@/services/organizations";
import { toast } from "@/lib/feedback/Toast/useToast";

const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "",
    first_name: "",
    email: "",
  };
};
let callOrgMember: any;

export default defineComponent({
  name: "ComponentUpdateUser",
  components: { OButton, ODialog, OInput, OSelect },
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
  setup() {
    const store: any = useStore();
    const { t } = useI18n();
    const roleOptions = ["admin"];
    const orgMemberData: any = ref(defaultValue());
    const roleError: any = ref('');

    return {
      t,
      orgMemberData,
      store,
      roleOptions,
      roleError,
      getImageURL,
    };
  },
  created() {
    if (this.modelValue) {
      this.orgMemberData = {
        org_member_id: this.modelValue.org_member_id,
        role: this.modelValue.role,
        first_name: this.modelValue.first_name,
        email: this.modelValue.email,
      };
    }
  },
  methods: {
    onSubmit() {
      if (!this.orgMemberData.role) {
        this.roleError = 'Role is required';
        return;
      }

      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
      });

      callOrgMember = organizationsService.update_member_role(
        {
          id: parseInt(this.orgMemberData.org_member_id),
          role: this.orgMemberData.role,
          organization_id: parseInt(this.store.state.selectedOrganization.id),
        },
        this.store.state.selectedOrganization.identifier
      );

      callOrgMember.then((res: { data: any }) => {
        if (res?.data?.error_members != null) {
          toast({
            variant: "error",
            message: "Error while updating organization member",
            timeout: 15000,
          });
        } else {
          toast({
            variant: "success",
            message: "Organization member updated successfully.",
          });
        }

        this.$emit("updated", res?.data);
        this.$emit("update:open", false);
        this.roleError = '';
        dismiss();
      });
    },
  },
});
</script>

<style lang="scss" scoped>
</style>
