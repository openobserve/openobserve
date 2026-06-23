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
  <ODialog data-test="add-user-dialog"
    :open="open"
    size="md"
    :title="beingUpdated ? t('user.editUser') : t('user.add')"
    :primaryButtonLabel="t('user.save')"
    :secondaryButtonLabel="t('user.cancel')"
    form-id="add-user-form"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div class="tw:w-full">
        <OForm
          id="add-user-form"
          ref="updateUserForm"
          :key="formMode"
          :schema="addUserSchema"
          :default-values="addUserDefaults"
          @submit="onSubmit"
        >
          <!-- <p class="tw:pt-2 tw:truncate">{{t('user.organization')}} : <strong>{{formData.organization}}</strong></p> -->
          <p class="tw:mt-2 tw:truncate" v-if="!existingUser">
            {{ t("user.email") }} : <strong>{{ formData.email }}</strong>
          </p>
          <p class="tw:mt-2 tw:truncate" v-if="!existingUser && !beingUpdated">
            {{ t("user.roles") }} : <strong>{{ formData.role }}</strong>
          </p>
          <p
            class="tw:mt-2 tw:truncate"
            v-if="
              !existingUser && !beingUpdated && formData?.custom_role?.length
            "
          >
            {{ t("user.customRole") }} :
            <strong>{{ formData.custom_role.join(", ") }}</strong>
          </p>
          <OFormInput
            v-if="existingUser && !beingUpdated"
            v-model="formData.email"
            name="email"
            :label="t('user.email')"
            required
            class="showLabelOnTop"
            maxlength="100"
            data-test="user-email-field"
          />

          <div v-if="!beingUpdated && !existingUser" class="tw:mt-2">
            <OFormInput
              :type="isPwd ? 'password' : 'text'"
              v-model="formData.password"
              name="password"
              :label="t('user.password')"
              required
              class="showLabelOnTop"
              data-test="user-password-field"
            >
              <template #icon-right>
                <OIcon
                  :name="isPwd ? 'visibility-off' : 'visibility'" size="sm"
                  class="tw:cursor-pointer"
                  @click="isPwd = !isPwd"
                />
              </template>
            </OFormInput>
          </div>

          <OFormInput
            v-if="!existingUser && !isCloud"
            v-model="formData.first_name"
            name="first_name"
            :label="t('user.firstName')"
            class="showLabelOnTop tw:mt-2"
            data-test="user-first-name-field"
          />

          <OFormInput
            v-if="!existingUser && !isCloud"
            v-model="formData.last_name"
            name="last_name"
            :label="t('user.lastName')"
            class="showLabelOnTop tw:mt-2"
            data-test="user-last-name-field"
          />
          <OFormSelect
            v-if="
              (existingUser || beingUpdated) &&
              userRole !== 'member' &&
              store.state.userInfo.email !== formData.email
            "
            v-model="formData.role"
            name="role"
            :label="t('user.role')"
            required
            :options="roles"
            class="showLabelOnTop tw:mt-2"
            data-test="user-role-field"
          />
          <OFormSelect
            v-if="
              (existingUser || beingUpdated) &&
              userRole !== 'member' &&
              store.state.userInfo.email !== formData.email &&
              (config.isEnterprise == 'true' || config.isCloud == 'true')
            "
            v-model="formData.custom_role"
            name="custom_role"
            :label="t('user.customRole')"
            :options="filterdOption"
            class="showLabelOnTop tw:mt-2"
            multiple
            data-test="user-custom-role-field"
            :disable="isCloud ? filterdOption.length === 0 : (filterdOption.length === 0 || !!formData.is_external)"
            :hint="
              isCloud
                ? (filterdOption.length === 0 ? t('user.noCustomRolesHint') : '')
                : formData.is_external
                  ? t('user.externalUserCustomRoleHint')
                  : filterdOption.length === 0
                    ? t('user.noCustomRolesHint')
                    : ''
            "
          />
          <div v-if="beingUpdated && !isCloud" class="tw:mt-2">
            <OFormSwitch
              v-model="formData.change_password"
              name="change_password"
              :label="t('user.changePassword')"
              size="lg"
              data-test="user-change-password-field"
            />

            <OFormInput
              v-if="
                formData.change_password &&
                (userRole == 'member' ||
                  store.state.userInfo.email == formData.email)
              "
              :type="isOldPwd ? 'password' : 'text'"
              v-model="formData.old_password"
              name="old_password"
              :label="t('user.oldPassword')"
              required
              class="showLabelOnTop tw:mt-2"
              data-test="user-old-passoword-field"
            >
              <template #icon-right>
                <OIcon
                  :name="isOldPwd ? 'visibility-off' : 'visibility'" size="sm"
                  class="tw:cursor-pointer"
                  @click="isOldPwd = !isOldPwd"
                />
              </template>
            </OFormInput>

            <OFormInput
              v-if="formData.change_password"
              :type="isNewPwd ? 'password' : 'text'"
              v-model="formData.new_password"
              name="new_password"
              :label="t('user.newPassword')"
              required
              class="showLabelOnTop tw:mt-2"
              data-test="user-new-password-field"
            >
              <template #icon-right>
                <OIcon
                  :name="isNewPwd ? 'visibility-off' : 'visibility'" size="sm"
                  class="tw:cursor-pointer"
                  @click="isNewPwd = !isNewPwd"
                />
              </template>
            </OFormInput>
          </div>
          <OFormInput
            v-if="
              !beingUpdated &&
              userRole != 'member' &&
              formData.organization == 'other'
            "
            v-model="formData.other_organization"
            name="other_organization"
            :label="t('user.otherOrganization')"
            class="showLabelOnTop tw:mt-2"
            maxlength="100"
          />
        </OForm>
    </div>
  </ODialog>
  <ODialog data-test="add-user-logout-confirm-dialog"
    v-model:open="logout_confirm"
    persistent
    size="xs"
    title="Password Changed"
    primary-button-label="Ok"
    @click:primary="signout"
  >
    <div class="tw:flex tw:items-center tw:gap-3">
      <div class="tw:bg-[var(--o2-primary)] tw:text-white tw:inline-flex tw:items-center tw:justify-center tw:w-10 tw:h-10 tw:rounded-full tw:shrink-0">
        <OIcon name="info" size="sm" />
      </div>
      <span>As you've chosen to change your password, you'll be automatically
        logged out.</span
      >
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onActivated, onBeforeMount, watch } from "vue";
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
  components: { ODialog,
    OIcon,
    OForm,
    OFormInput,
    OFormSelect,
    OFormSwitch,
},
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
      type: Array,
      default: () => [
        {
          label: "Admin",
          value: "admin",
        },
      ],
    },
    customRoles: {
      type: Array,
      default: () => [],
    },
    isCloud: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "updated", "update:open"],
  setup(props) {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const formData: any = ref(defaultValue());
    const existingUser = ref(true);
    const beingUpdated: any = ref(false);
    const updateUserForm: any = ref(null);
    const isPwd: any = ref(true);
    const isNewPwd: any = ref(true);
    const isOldPwd: any = ref(true);
    let organizationOptions: any = ref([]);
    const loadingOrganizations = ref(true);
    const logout_confirm = ref(false);
    const loggedInUserEmail = ref(store.state.userInfo.email);
    const filterdOption = ref([...props.customRoles]);

    // Mode key: the form validates a different subset per mode, and the 422
    // "this email is actually new" flow flips existingUser → false mid-flight.
    // Re-keying <OForm> on this remounts it so the new schema applies (values are
    // preserved because :default-values re-seeds from the persistent formData).
    const formMode = computed(() => {
      if (beingUpdated.value) return "edit";
      if (existingUser.value) return "add-existing";
      return "add-new";
    });

    // Conditional schema (returned from setup → in template scope). The factory
    // reads the non-form context; superRefine reads form values (incl.
    // change_password) at validation time.
    const addUserSchema = computed(() =>
      makeAddUserSchema({
        existingUser: existingUser.value,
        beingUpdated: beingUpdated.value,
        userRole: props.userRole,
        loggedInUserEmail: loggedInUserEmail.value,
        modelEmail: props.modelValue?.email ?? "",
        organization: formData.value.organization,
      }),
    );

    // The OForm owns every editable field; formData stays the single working
    // source for the conditionals/handler (the sanctioned entangled-form
    // exception), kept in sync by the fields' v-model. :default-values re-seeds
    // from it on (re)mount.
    const addUserDefaults = computed((): AddUserForm => ({
      email: formData.value.email ?? "",
      password: formData.value.password ?? "",
      first_name: formData.value.first_name ?? "",
      last_name: formData.value.last_name ?? "",
      role: formData.value.role ?? "",
      custom_role: formData.value.custom_role ?? [],
      change_password: formData.value.change_password ?? false,
      old_password: formData.value.old_password ?? "",
      new_password: formData.value.new_password ?? "",
      other_organization: formData.value.other_organization ?? "",
    }));

    watch(
      () => props.customRoles,
      (next) => {
        filterdOption.value = [...next];
      },
    );

    onActivated(() => {
      formData.value.organization = store.state.selectedOrganization.identifier;
    });

    onBeforeMount(() => setOrganizationOptions());

    watch(
      () => store.state.organizations,
      () => setOrganizationOptions(),
      { deep: true },
    );

    // Reset form state only when the dialog transitions from closed → open.
    // Previously this was a deep watch on modelValue, but parent-side mutations
    // of selectedUser caused it to fire mid-flight and reset existingUser back
    // to true, undoing the 422-catch transition from "add existing user" to
    // "create new user" and hiding the password/name fields.
    const resetFormFromModelValue = (newVal: any) => {
      if (newVal && newVal.email != undefined && newVal.email != "") {
        beingUpdated.value = true;
        existingUser.value = false;
        // Row data from the users list doesn't include `organization`; fall back
        // to the active org so the subsequent PUT lands on the right endpoint.
        formData.value = {
          ...newVal,
          organization:
            newVal.organization || store.state.selectedOrganization.identifier,
          change_password: false,
          password: "",
        };
        if (config.isEnterprise == "true" || config.isCloud == true) {
          const orgId = store.state.selectedOrganization.identifier;
          userServiece
            .getUserRoles(orgId, newVal.email)
            .then((response: any) => {
              formData.value.custom_role = response.data;
              // custom_role arrives AFTER mount (async) — bridge it into the form
              // so the OFormSelect displays it (the form's value, not formData,
              // is what's rendered). Per the playbook "data arrives after mount".
              updateUserForm.value?.form?.setFieldValue(
                "custom_role",
                response.data,
              );
            })
            .catch((error: any) => {
              console.error("Error fetching user roles:", error);
            });
        }
      } else {
        beingUpdated.value = props.isUpdated;
        existingUser.value = true;
        formData.value = defaultValue();
        formData.value.organization =
          store.state.selectedOrganization.identifier;
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
          label: "Other",
          value: "other",
        });
      }
      formData.value.organization = store.state.selectedOrganization.identifier;
    };

    // Options-API: the schema (and the defaults computed) MUST be returned from
    // setup() — a bare module import is out of the template's scope, so :schema
    // would resolve to undefined and validation would silently no-op.
    return {
      t,
      store,
      router,
      formData,
      beingUpdated,
      updateUserForm,
      formMode,
      addUserSchema,
      addUserDefaults,
      isPwd,
      isNewPwd,
      isOldPwd,
      organizationOptions,
      existingUser,
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
          const needle = val.toLowerCase()
          filterdOption.value = props.customRoles.filter((v:any) => v.toLowerCase().indexOf(needle) > -1)
        })
      },
      track,
    };
  },
  methods: {
    signout() {
      // Always call backend logout to clear auth cookies (#10900)
      this.invalidateLoginData();

      this.store.dispatch("logout");

      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);

      this.$router.push("/logout");
    },
    // Plain async @submit handler — fires only after the Zod schema passes
    // (AddUser.schema.ts now owns the email / role / password / org rules that
    // used to be manual emailError/roleError/passwordError refs + toast checks).
    // OForm awaits it, so the footer Save spinner spans the request automatically
    // (no manual loading toast). `formData` is the working source of truth.
    async onSubmit() {
      let selectedOrg = this.formData.organization;
      if (selectedOrg == "other") {
        selectedOrg = encodeURIComponent(this.formData.other_organization);
      }
      if (this.beingUpdated) {
        const userEmail = this.formData.email;
        delete this.formData.email;

        if (this.formData.change_password == false) {
          delete this.formData.old_password;
          delete this.formData.new_password;
        }
        try {
          const res: any = await userServiece.update(
            this.formData,
            selectedOrg,
            userEmail,
          );
          if (
            this.formData.change_password == true &&
            this.loggedInUserEmail === this.modelValue?.email
          ) {
            this.logout_confirm = true;
          } else {
            this.formData.email = userEmail;
            this.$emit("updated", res.data, this.formData, "updated");
            this.$emit("update:open", false);
          }
        } catch (err: any) {
          toast({
            variant: "error",
            message: err.response.data.message,
          });
          this.formData.email = userEmail;
        }
        this.track("Button Click", {
          button: "Update User",
          page: "Add User",
        });
      } else {
        if (this.existingUser) {
          const userEmail = this.formData.email;

          try {
            const res: any = await userServiece.updateexistinguser(
              {
                role: this.formData.role,
                custom_role: this.formData.custom_role,
              },
              selectedOrg,
              userEmail,
            );
            this.formData.email = userEmail;
            this.existingUser = true;
            this.$emit("updated", res.data, this.formData, "created");
            this.$emit("update:open", false);
          } catch (err: any) {
            if (err.response.data.code === 422) {
              // The email is actually new → switch to "create new user" mode.
              // formMode flips to "add-new", which re-keys <OForm> so the schema
              // now enforces the password policy.
              this.existingUser = false;
            } else {
              if (err.response?.status != 403 || err?.status != 403) {
                toast({
                  variant: "error",
                  message: err.response.data.message,
                });
              }
              this.formData.email = userEmail;
            }
          }
          this.track("Button Click", {
            button: "Update User",
            page: "Add User",
          });
        } else {
          try {
            const res: any = await userServiece.create(
              this.formData,
              selectedOrg,
            );
            this.$emit("updated", res.data, this.formData, "created");
            this.$emit("update:open", false);
          } catch (err: any) {
            toast({
              variant: "error",
              message: err.response.data.message,
            });
          }
          this.track("Button Click", {
            button: "Create User",
            page: "Add User",
          });
        }
      }
    },
    async fetchUserRoles(userEmail: any) {
      const orgId = this.store.state.selectedOrganization.identifier;
      try {
        const response = await userServiece.getUserRoles(orgId, userEmail);
        const existingUserRoles = response.data;
        this.formData.custom_role = existingUserRoles;
      } catch (error) {
        console.error("Error fetching user roles:", error);
      }
    },
  },
  computed: {
    combinedRoles() {
      return [...this.roles, ...this.customRoles];
    },
  },
});
</script>
