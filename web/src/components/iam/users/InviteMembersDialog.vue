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
    data-test="invite-members-dialog"
    :open="open"
    size="sm"
    :title="t('user.inviteMembers')"
    :sub-title="t('user.inviteMembersSubtitle')"
    :form-id="FORM_ID"
    :primary-button-label="t('user.sendInvites')"
    :secondary-button-label="t('user.cancel')"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <!-- OForm reads default-values once, so it mounts only after the role list settles. -->
    <OForm
      v-if="rolesSettled"
      :id="FORM_ID"
      class="flex flex-col gap-5"
      :schema="schema"
      :default-values="defaults"
      @submit="onSubmit"
    >
      <OFormInput
        name="email"
        :label="t('user.inviteEmailsLabel')"
        :help-text="t('user.inviteEmailsHelp')"
        autocomplete="off"
        autofocus
        required
        data-test="invite-members-dialog-emails-input"
      />
      <OFormSelect
        name="role"
        :label="t('user.role')"
        :options="roleOptions"
        required
        data-test="invite-members-dialog-role-select"
      />
    </OForm>
    <div v-else class="flex justify-center py-6" data-test="invite-members-dialog-loading">
      <OSpinner size="md" />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import organizationsService from "@/services/organizations";
import analytics from "@/services/product_analytics";
import { assignableRolesQuery } from "@/services/users.queries";
import {
  makeMemberInvitationSchema,
  memberInvitationDefaults,
  pickDefaultInviteRole,
  splitInviteEmails,
  type MemberInvitationForm,
} from "./MemberInvitation.schema";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Prefills the email field each time the dialog opens. */
    initialEmail?: string;
  }>(),
  { initialEmail: "" },
);

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "inviteSent"): void;
}>();

const FORM_ID = "invite-members-form";

const store = useStore();
const { t } = useI18nTyped();

const schema = makeMemberInvitationSchema(t);

// Same cache entry the users list already warmed, so the dialog normally opens without a spinner.
const rolesQuery = useQuery(() =>
  assignableRolesQuery(store.state.selectedOrganization.identifier),
);
const roleOptions = computed<SelectOption[]>(() =>
  Array.isArray(rolesQuery.data.value) ? rolesQuery.data.value : [],
);
const rolesSettled = computed(() => !rolesQuery.isPending.value);

const defaults = computed(() =>
  memberInvitationDefaults(props.initialEmail, pickDefaultInviteRole(roleOptions.value)),
);

const onSubmit = async (value: MemberInvitationForm) => {
  const emailArray = Array.from(
    new Set(splitInviteEmails(value.email).map((email) => email.toLowerCase())),
  );

  try {
    const res = await organizationsService.add_members(
      { invites: emailArray, role: value.role },
      store.state.selectedOrganization.identifier,
    );
    const data = res.data;

    if (data.data.invalid_members != null) {
      toast({
        variant: "error",
        message: t("iam.memberInvitation.errorWhileInvitation", {
          members: data.data.invalid_members.toString(),
        }),
        timeout: 15000,
      });
    } else {
      toast({
        variant: "success",
        message: raw(data.message),
        timeout: 5000,
      });
      emit("inviteSent");
      emit("update:open", false);
    }
  } catch (error) {
    const err = error as { message?: string; response?: { data?: { message?: string } } };
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message || err?.message),
      timeout: 5000,
    });
  }

  analytics.track("Button Click", {
    button: "Invite User",
    user_org: store.state.selectedOrganization.identifier,
    user_id: store.state.userInfo.email,
    page: "Users",
  });
};
</script>
