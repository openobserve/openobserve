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
  <div class="tw:rounded-md tw:p-0" style="min-height: inherit">
    <div
      class="tw:flex tw:items-center tw:gap-3"
      v-if="currentUserRole == 'admin' || currentUserRole == 'root'"
    >
      <div style="position: relative">
        <OInput
          v-model="userEmail"
          :placeholder="t('user.inviteByEmail')"
          class="tw:w-56"
        />
        <OTooltip :content="t('user.inviteByEmail')" side="top" max-width="16rem" />
      </div>
      <OSelect
        v-model="selectedRole"
        :options="options"
        labelKey="label"
        valueKey="value"
        style="width: 120px"
      />
      <OButton
        variant="primary"
        size="xs"
        class="tw:!h-8"
        :disabled="userEmail == ''"
        @click="inviteUser()"
      >
        {{ t('user.sendInvite') }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { validateEmail } from "@/utils/zincutils";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import { getRoles } from "@/services/iam";
import usersService from "@/services/users";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "MemberInvitationPage",
  components: { OButton, OInput, OSelect, OTooltip },
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

    const userEmail: any = ref("");
    const options = ref();
    const selectedRole = ref("admin");
    const currentUserRole = ref(props.currentrole || "");

    onBeforeMount(async () => {
      currentUserRole.value = props.currentrole;
      await getRoles();
    });

    const inviteUser = () => {
      const emailArray = Array.from(
        new Set(
          userEmail.value
            .split(";")
            .flatMap((email: any) => email.split(","))
            .filter((email: any) => email.trim().length > 0)
            .map((email: any) => email.trim().toLowerCase())
        )
      );
      const validationArray = emailArray.map((email: any) =>
        validateEmail(email),
      );

      if (!validationArray.includes(false)) {
        const dismiss = toast({
          variant: "loading",
          message: "Please wait...",
                  timeout: 0,
});

        organizationsService
          .add_members(
            { invites: emailArray, role: selectedRole.value },
            store.state.selectedOrganization.identifier,
          )
          .then((res: { data: any }) => {
            const data = res.data;

            if (data.data.invalid_members != null) {
              const message = `Error while member invitation: ${data.data.invalid_members.toString()}`;

              toast({
                variant: "error",
                message: message,
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
            }

            dismiss();
          })
          .catch((error) => {
            dismiss();
            toast({
              variant: "error",
              message: error?.response?.data?.message || error.message,
              timeout: 5000,
            });
          });

        userEmail.value = "";

        segment.track("Button Click", {
          button: "Invite User",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          page: "Users",
        });
      } else {
        toast({
          variant: "error",
          message: `Please enter correct email id.`,
        });
      }
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
      userEmail,
      selectedRole,
      options,
      inviteUser,
      currentUserRole,
    };
  },
});
</script>

<style lang="scss" scoped>
.invite-user {
  background: $input-bg;
  border-radius: 4px;

  .separator {
    width: 1px;
  }
}

.inputHint {
  font-size: 11px;
  color: $light-text;
}
</style>
