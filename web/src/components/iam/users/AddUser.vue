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
    data-test="add-user-dialog"
    :open="open"
    size="md"
    :title="beingUpdated ? t('user.editUser') : t('user.add')"
    :primaryButtonLabel="t('user.save')"
    :secondaryButtonLabel="t('user.cancel')"
    form-id="add-user-form"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div class="w-full">
      <OForm id="add-user-form" :form="form">
        <p class="mt-2 truncate" v-if="!existingUser">
          {{ t("user.email") }} : <strong>{{ formEmail }}</strong>
        </p>
        <p class="mt-2 truncate" v-if="!existingUser && !beingUpdated">
          {{ t("user.roles") }} : <strong>{{ formRole }}</strong>
        </p>
        <p class="mt-2 truncate" v-if="!existingUser && !beingUpdated && formCustomRole?.length">
          {{ t("user.customRole") }} :
          <strong>{{ formCustomRole.join(", ") }}</strong>
        </p>
        <OFormInput
          v-if="existingUser && !beingUpdated"
          name="email"
          :label="t('user.email')"
          required
          class="showLabelOnTop"
          :maxlength="100"
          data-test="user-email-field"
        />

        <div v-if="!beingUpdated && !existingUser" class="mt-2">
          <OFormInput
            :type="isPwd ? 'password' : 'text'"
            name="password"
            :label="t('user.password')"
            required
            class="showLabelOnTop"
            data-test="user-password-field"
          >
            <template #icon-right>
              <OIcon
                :name="isPwd ? 'visibility-off' : 'visibility'"
                size="sm"
                class="cursor-pointer"
                @click="isPwd = !isPwd"
              />
            </template>
          </OFormInput>
        </div>

        <OFormInput
          v-if="!existingUser && !isCloud"
          name="first_name"
          :label="t('user.firstName')"
          class="showLabelOnTop mt-2"
          data-test="user-first-name-field"
        />

        <OFormInput
          v-if="!existingUser && !isCloud"
          name="last_name"
          :label="t('user.lastName')"
          class="showLabelOnTop mt-2"
          data-test="user-last-name-field"
        />
        <OFormSelect
          v-if="
            (existingUser || beingUpdated) &&
            userRole !== 'member' &&
            store.state.userInfo.email !== formEmail
          "
          name="role"
          :label="t('user.role')"
          required
          :options="roles"
          class="showLabelOnTop mt-2"
          data-test="user-role-field"
        />
        <OFormSelect
          v-if="
            (existingUser || beingUpdated) &&
            userRole !== 'member' &&
            store.state.userInfo.email !== formEmail &&
            (config.isEnterprise == 'true' || config.isCloud == 'true')
          "
          name="custom_role"
          :label="t('user.customRole')"
          :options="filterdOption"
          class="showLabelOnTop mt-2"
          multiple
          data-test="user-custom-role-field"
          :disable="
            isCloud ? filterdOption.length === 0 : filterdOption.length === 0 || !!isExternalUser
          "
          :hint="
            isCloud
              ? filterdOption.length === 0
                ? t('user.noCustomRolesHint')
                : ''
              : isExternalUser
                ? t('user.externalUserCustomRoleHint')
                : filterdOption.length === 0
                  ? t('user.noCustomRolesHint')
                  : ''
          "
        />
        <div v-if="beingUpdated && !isCloud" class="mt-2">
          <OFormSwitch
            name="change_password"
            :label="t('user.changePassword')"
            size="lg"
            data-test="user-change-password-field"
          />

          <OFormInput
            v-if="
              changePassword && (userRole == 'member' || store.state.userInfo.email == formEmail)
            "
            :type="isOldPwd ? 'password' : 'text'"
            name="old_password"
            :label="t('user.oldPassword')"
            required
            class="showLabelOnTop mt-2"
            data-test="user-old-passoword-field"
          >
            <template #icon-right>
              <OIcon
                :name="isOldPwd ? 'visibility-off' : 'visibility'"
                size="sm"
                class="cursor-pointer"
                @click="isOldPwd = !isOldPwd"
              />
            </template>
          </OFormInput>

          <OFormInput
            v-if="changePassword"
            :type="isNewPwd ? 'password' : 'text'"
            name="new_password"
            :label="t('user.newPassword')"
            required
            class="showLabelOnTop mt-2"
            data-test="user-new-password-field"
          >
            <template #icon-right>
              <OIcon
                :name="isNewPwd ? 'visibility-off' : 'visibility'"
                size="sm"
                class="cursor-pointer"
                @click="isNewPwd = !isNewPwd"
              />
            </template>
          </OFormInput>
        </div>
        <OFormInput
          v-if="!beingUpdated && userRole != 'member' && organization == 'other'"
          name="other_organization"
          :label="t('user.otherOrganization')"
          class="showLabelOnTop mt-2"
          :maxlength="100"
        />
      </OForm>
    </div>
  </ODialog>
  <ODialog
    data-test="add-user-logout-confirm-dialog"
    v-model:open="logout_confirm"
    persistent
    size="xs"
    :title="t('iam.addUser.passwordChanged')"
    :primary-button-label="t('iam.addUser.ok')"
    @click:primary="signout"
  >
    <div class="flex items-center gap-3">
      <div
        class="bg-accent text-text-inverse inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
      >
        <OIcon name="info" size="sm" />
      </div>
      <span>{{ t("iam.addUser.changePasswordLogoutMessage") }}</span>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated, onBeforeMount, watch, type PropType } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import userServiece from "@/services/users";
import {
  getImageURL,
  useLocalCurrentUser,
  useLocalUserInfo,
  invalidateLoginData,
} from "@/utils/zincutils";
import config from "@/aws-exports";
import { useReo } from "@/services/reodotdev_analytics";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeAddUserSchema, type AddUserForm } from "./AddUser.schema";
const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "",
    first_name: "",
    last_name: "",
    email: "",
    old_password: "",
    new_password: "",
    change_password: false,
    organization: "",
    other_organization: "",
  };
};

export default defineComponent({
  name: "ComponentAddUpdateUser",
  components: { ODialog, OIcon, OForm, OFormInput, OFormSelect, OFormSwitch },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    userRole: {
      type: String,
      default: "admin",
    },
    roles: {
      type: Array as PropType<{ label: string; value: string }[]>,
      default: () => [
        {
          label: "Admin",
          value: "admin",
        },
      ],
    },
    customRoles: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    isCloud: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "updated", "update:open"],
  setup(props, { emit }) {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const existingUser = ref(true);
    const beingUpdated: any = ref(false);
    const isPwd: any = ref(true);
    const isNewPwd: any = ref(true);
    const isOldPwd: any = ref(true);
    let organizationOptions: any = ref([]);
    const loadingOrganizations = ref(true);
    const logout_confirm = ref(false);
    const loggedInUserEmail = ref(store.state.userInfo.email);
    const filterdOption = ref([...props.customRoles]);

    // Non-form context: the org the user is assigned to, the original record we
    // round-trip on edit, and whether the edited user is external. These are NOT
    // form fields — they live OUTSIDE <OForm>, read by the owner's v-if /
    // schema-context / submit handler.
    const organization = ref(store.state.selectedOrganization.identifier);
    const editRecord: any = ref(null);
    const isExternalUser = ref(false);

    const blankForm = (): AddUserForm => ({
      email: "",
      password: "",
      first_name: "",
      last_name: "",
      role: "",
      custom_role: [],
      change_password: false,
      old_password: "",
      new_password: "",
      other_organization: "",
    });

    // `custom_role` is an Enterprise/Cloud-only concept — the field is rendered
    // and hydrated (getUserRoles) ONLY under this flag.
    const supportsCustomRole = config.isEnterprise == "true" || config.isCloud == "true";

    // Decide whether to send `custom_role`:
    //   • OSS → never (the field is Enterprise/Cloud-only).
    //   • edit → always (getUserRoles always hydrates it, even to `[]`).
    //   • otherwise (add-existing / create-new) → only when the user actually
    //     selected roles (length > 0).
    const includeCustomRole = (value: AddUserForm) =>
      supportsCustomRole &&
      (beingUpdated.value || (Array.isArray(value.custom_role) && value.custom_role.length > 0));

    // The save handler reads the VALIDATED `value` only. Non-form context (org,
    // the original edit record) comes from the refs above. OForm awaits it, so
    // the footer Save spinner spans the request.
    const onSubmit = async (value: AddUserForm) => {
      let selectedOrg = organization.value;
      if (selectedOrg == "other") {
        selectedOrg = encodeURIComponent(value.other_organization);
      }
      if (beingUpdated.value) {
        const userEmail = editRecord.value?.email ?? value.email;
        // Round-trip the original record with the edited fields, minus email.
        const payload: any = {
          ...editRecord.value,
          first_name: value.first_name,
          last_name: value.last_name,
          role: value.role,
          change_password: value.change_password,
          organization: selectedOrg,
        };
        // Send the hydrated custom_role on Enterprise/Cloud edits; otherwise
        // drop it (the editRecord spread could also leak it).
        if (includeCustomRole(value)) {
          payload.custom_role = value.custom_role;
        } else {
          delete payload.custom_role;
        }
        delete payload.email;
        if (value.change_password) {
          payload.old_password = value.old_password;
          payload.new_password = value.new_password;
        } else {
          delete payload.old_password;
          delete payload.new_password;
        }
        try {
          const res: any = await userServiece.update(payload, selectedOrg, userEmail);
          if (
            value.change_password == true &&
            loggedInUserEmail.value === props.modelValue?.email
          ) {
            logout_confirm.value = true;
          } else {
            emit("updated", res.data, { ...payload, email: userEmail }, "updated");
            emit("update:open", false);
          }
        } catch (err: any) {
          toast({
            variant: "error",
            message: err.response.data.message,
          });
        }
        track("Button Click", { button: "Update User", page: "Add User" });
      } else if (existingUser.value) {
        const userEmail = value.email;
        try {
          const existingUserBody: any = { role: value.role };
          if (includeCustomRole(value)) {
            existingUserBody.custom_role = value.custom_role;
          }
          const res: any = await userServiece.updateexistinguser(
            existingUserBody,
            selectedOrg,
            userEmail,
          );
          emit(
            "updated",
            res.data,
            { ...value, email: userEmail, organization: selectedOrg },
            "created",
          );
          emit("update:open", false);
        } catch (err: any) {
          if (err.response.data.code === 422) {
            // The email is actually new → switch to "create new user" mode. The
            // schema reads existingUser live, so it enforces the password policy
            // without a remount.
            existingUser.value = false;
          } else {
            if (err.response?.status != 403 || err?.status != 403) {
              toast({
                variant: "error",
                message: err.response.data.message,
              });
            }
          }
        }
        track("Button Click", { button: "Update User", page: "Add User" });
      } else {
        try {
          const payload: any = {
            ...value,
            org_member_id: "",
            organization: selectedOrg,
          };
          // create-new has no populated custom_role (the select is hidden in
          // create mode) unless it was carried over from add-existing.
          if (!includeCustomRole(value)) {
            delete payload.custom_role;
          }
          const res: any = await userServiece.create(payload, selectedOrg);
          emit("updated", res.data, payload, "created");
          emit("update:open", false);
        } catch (err: any) {
          toast({
            variant: "error",
            message: err.response.data.message,
          });
        }
        track("Button Click", { button: "Create User", page: "Add User" });
      }
    };

    // This component renders <OForm>, so it creates the form here (useOForm) to
    // read it reactively (form.useStore) for parent-side v-if, then hands it down
    // via <OForm :form="form"> — ONE source of truth. The schema takes a context
    // GETTER so a single stable instance follows mode flips (e.g. the 422
    // add-existing → create-new switch) with no remount.
    const addUserSchema = makeAddUserSchema(
      () => ({
        existingUser: existingUser.value,
        beingUpdated: beingUpdated.value,
        userRole: props.userRole,
        loggedInUserEmail: loggedInUserEmail.value,
        modelEmail: props.modelValue?.email ?? "",
        organization: organization.value,
      }),
      t,
    );

    const form = useOForm<AddUserForm>({
      defaultValues: blankForm(),
      schema: addUserSchema,
      onSubmit,
    });

    // Reactive reads of the SAME form for the owner's conditional rendering (v-if)
    // and the read-only display lines — not a copy.
    const changePassword = form.useStore((s: any) => s.values.change_password);
    const formEmail = form.useStore((s: any) => s.values.email);
    const formRole = form.useStore((s: any) => s.values.role);
    const formCustomRole = form.useStore((s: any) => s.values.custom_role);

    watch(
      () => props.customRoles,
      (next) => {
        filterdOption.value = [...next];
      },
    );

    onActivated(() => {
      organization.value = store.state.selectedOrganization.identifier;
    });

    onBeforeMount(() => setOrganizationOptions());

    watch(
      () => store.state.organizations,
      () => setOrganizationOptions(),
      { deep: true },
    );

    // Reset form state only when the dialog transitions from closed → open.
    // A deep watch on modelValue must NOT be used: parent-side mutations of
    // selectedUser fire it mid-flight and reset existingUser back to true,
    // undoing the 422-catch add-existing → create-new transition and hiding
    // the password/name fields.
    const resetFormFromModelValue = (newVal: any) => {
      if (newVal && newVal.email != undefined && newVal.email != "") {
        beingUpdated.value = true;
        existingUser.value = false;
        // Row data from the users list doesn't include `organization`; fall back
        // to the active org so the subsequent PUT lands on the right endpoint.
        organization.value = newVal.organization || store.state.selectedOrganization.identifier;
        // Keep the full original record (org_member_id, is_external, …) to
        // round-trip on save — it is non-form context, NOT a form mirror.
        editRecord.value = {
          ...newVal,
          organization: organization.value,
          password: "",
        };
        isExternalUser.value = !!newVal.is_external;
        // Seed the form via reset(values) — never a per-field setFieldValue loop.
        form.reset({
          ...blankForm(),
          email: newVal.email ?? "",
          role: newVal.role ?? "",
          first_name: newVal.first_name ?? "",
          last_name: newVal.last_name ?? "",
          custom_role: newVal.custom_role ?? [],
        });
        if (config.isEnterprise == "true" || config.isCloud == true) {
          const orgId = store.state.selectedOrganization.identifier;
          userServiece
            .getUserRoles(orgId, newVal.email)
            .then((response: any) => {
              // custom_role arrives AFTER mount (async) — bridge it into the form
              // so the OFormSelect displays it.
              form.setFieldValue("custom_role", response.data);
            })
            .catch((error: any) => {
              console.error("Error fetching user roles:", error);
            });
        }
      } else {
        beingUpdated.value = props.isUpdated;
        existingUser.value = true;
        organization.value = store.state.selectedOrganization.identifier;
        editRecord.value = null;
        isExternalUser.value = false;
        form.reset(blankForm());
      }
    };

    watch(
      () => props.open,
      (isOpen, wasOpen) => {
        if (isOpen && !wasOpen) {
          resetFormFromModelValue(props.modelValue);
        }
      },
      { immediate: true },
    );

    const setOrganizationOptions = () => {
      organizationOptions.value = [];
      loadingOrganizations.value = !store.state.organizations.length;
      store.state.organizations.forEach((org: any) => {
        organizationOptions.value.push({
          label: org.name,
          value: org.identifier,
        });
      });

      if (props.userRole == "root") {
        organizationOptions.value.push({
          label: t("iam.addUser.other"),
          value: "other",
        });
      }
      organization.value = store.state.selectedOrganization.identifier;
    };

    // Options-API: everything the template binds MUST be returned from setup() —
    // a bare module import is out of the template's scope.
    return {
      t,
      store,
      router,
      form,
      beingUpdated,
      existingUser,
      organization,
      isExternalUser,
      changePassword,
      formEmail,
      formRole,
      formCustomRole,
      isPwd,
      isNewPwd,
      isOldPwd,
      organizationOptions,
      getImageURL,
      loadingOrganizations,
      logout_confirm,
      loggedInUserEmail,
      filterdOption,
      invalidateLoginData,
      config,
      filterFn(val: any, update: any) {
        if (val === "") {
          update(() => {
            filterdOption.value = props.customRoles;
          });
          return;
        }
        update(() => {
          const needle = val.toLowerCase();
          filterdOption.value = props.customRoles.filter(
            (v: any) => v.toLowerCase().indexOf(needle) > -1,
          );
        });
      },
      track,
    };
  },
  methods: {
    signout() {
      // Always call backend logout to clear auth cookies
      this.invalidateLoginData();

      this.store.dispatch("logout");

      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);

      this.$router.push("/logout");
    },
  },
  computed: {
    combinedRoles() {
      return [...this.roles, ...this.customRoles];
    },
  },
});
</script>
