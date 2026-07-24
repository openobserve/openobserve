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
  <div class="rounded-default p-0" style="min-height: inherit">
    <div v-if="currentUserRole == 'admin' || currentUserRole == 'root'">
      <!-- Inline form (no dialog): the Save button lives inside <OForm>, so it is
           type="submit" — Enter submits natively, no form-id needed. -->
      <OForm
        id="member-invitation-form"
        ref="memberInvitationForm"
        class="flex items-center gap-3"
        :schema="memberInvitationSchema"
        :default-values="memberInvitationDefaults()"
        @submit="onSubmit"
        v-slot="{ isSubmitting }"
      >
        <div class="relative">
          <OFormInput
            name="email"
            :placeholder="t('user.inviteByEmail')"
            class="w-56"
          />
          <OTooltip :content="t('user.inviteByEmail')" side="top" max-width="16rem" />
        </div>
        <OFormSelect
          name="role"
          :options="options"
          labelKey="label"
          valueKey="value"
          style="width: 120px"
        />
        <OButton
          variant="primary"
          size="xs"
          class="!h-8"
          type="submit"
          :loading="isSubmitting"
        >
          {{ t('user.sendInvite') }}
        </OButton>
      </OForm>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import usersService from "@/services/users";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeMemberInvitationSchema,
  memberInvitationDefaults,
  splitInviteEmails,
  type MemberInvitationForm,
} from "./MemberInvitation.schema";

export default defineComponent({
  name: "MemberInvitationPage",
  components: { OButton, OForm, OFormInput, OFormSelect, OTooltip },
  props: {
    currentrole: {
      type: String,
      required: true,
    },
  },
  emits: ["inviteSent"],
  setup(props: any, { emit }) {
    const store = useStore();
    const { t } = useI18n();

    const memberInvitationSchema = makeMemberInvitationSchema(t);

    const options = ref();
    const currentUserRole = ref(props.currentrole || "");
    const memberInvitationForm: any = ref(null);

    onBeforeMount(async () => {
      currentUserRole.value = props.currentrole;
      await getRoles();
    });

    // Plain async @submit handler — fires only after the schema passes (email
    // required + every address valid). The multi-email split/dedup stays here.
    // OForm awaits it, so the inline Save button's spinner spans the request.
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
            message: t('iam.memberInvitation.errorWhileInvitation', { members: data.data.invalid_members.toString() }),
            timeout: 15000,
          });
        } else {
          toast({
            variant: "success",
            message: data.message,
            timeout: 5000,
          });
          // Emit event to parent to refresh the members list
          emit("inviteSent");
          // Clear the invite row (create / "add another"): reset email to blank
          // and submit-state to 0 (no "required" flash) while keeping the role.
          memberInvitationForm.value?.form.reset({ email: "", role: value.role });
        }
      } catch (error: any) {
        toast({
          variant: "error",
          message: error?.response?.data?.message || error.message,
          timeout: 5000,
        });
      }

      segment.track("Button Click", {
        button: "Invite User",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Users",
      });
    };

    const getRoles = () => {
      return new Promise((resolve) => {
        usersService
          .getRoles(store.state.selectedOrganization.identifier)
          .then((res) => {
            options.value = res.data;
          })
          .finally(() => resolve(true));
      });
    };

    return {
      t,
      options,
      currentUserRole,
      memberInvitationForm,
      memberInvitationSchema,
      memberInvitationDefaults,
      onSubmit,
    };
  },
});
</script>
