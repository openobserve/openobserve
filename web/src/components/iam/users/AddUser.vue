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
  <q-card class="o2-side-dialog column full-height ">
    <q-card-section class="q-py-md tw:w-full">
      <div class="row items-center no-wrap q-py-sm">
        <div class="col">
          <div v-if="beingUpdated" style="font-size: 18px">
            {{ t("user.editUser") }}
          </div>
          <div v-else style="font-size: 18px">{{ t("user.add") }}</div>
        </div>
        <div class="col-auto">
          <q-icon
            data-test="add-user-close-dialog-btn"
            name="cancel"
            class="cursor-pointer"
            size="20px"
            @click="$emit('cancel:hideform')"
          />
        </div>
      </div>

      <q-separator />
      <div>
        <q-form ref="updateUserForm" @submit.prevent="onSubmit">
          <!-- <p class="q-pt-sm tw:truncate">{{t('user.organization')}} : <strong>{{formData.organization}}</strong></p> -->
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
          <q-input
            v-if="existingUser && !beingUpdated"
            v-model="formData.email"
            :label="t('user.email') + ' *'"
            class="showLabelOnTop tw:mt-2"
            stack-label
            hide-bottom-space
            dense
            borderless
            :rules="[
              (val: any, rules: any) =>
                rules.email(val) || 'Please enter a valid email address',
            ]"
            maxlength="100"
            data-test="user-email-field"
          />

          <div v-if="!beingUpdated && !existingUser" class="tw:mt-2">
            <q-input
              :type="isPwd ? 'password' : 'text'"
              v-model="formData.password"
              :label="t('user.password') + ' *'"
              class="showLabelOnTop"
              stack-label
              dense
              borderless
              hide-bottom-space
              :rules="[
                (val: any) => !!val || 'Field is required',
                (val: any) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
              data-test="user-password-field"
            >
              <template v-slot:append>
                <q-icon
                  :name="isPwd ? 'visibility_off' : 'visibility'"
                  class="cursor-pointer"
                  @click="isPwd = !isPwd"
                />
              </template>
            </q-input>
          </div>

          <q-input
            v-if="!existingUser"
            v-model="formData.first_name"
            :label="t('user.firstName')"
            class="showLabelOnTop tw:mt-2"
            stack-label
            dense
            hide-bottom-space
            borderless
            data-test="user-first-name-field"
          />

          <q-input
            v-if="!existingUser"
            v-model="formData.last_name"
            :label="t('user.lastName')"
            class="showLabelOnTop tw:mt-2"
            stack-label
            dense
            hide-bottom-space
            borderless
            data-test="user-last-name-field"
          />
          <q-select
            v-if="
              (existingUser || beingUpdated) &&
              userRole !== 'member' &&
              store.state.userInfo.email !== formData.email
            "
            v-model="formData.role"
            :label="t('user.role') + ' *'"
            :options="roles"
            class="showLabelOnTop tw:mt-2"
            emit-value
            map-options
            stack-label
            dense
            hide-bottom-space
            borderless
            :rules="[(val: any) => !!val || 'Field is required']"
            data-test="user-role-field"
          />
          <q-select
            v-if="
              (existingUser || beingUpdated) &&
              userRole !== 'member' &&
              store.state.userInfo.email !== formData.email &&
              (config.isEnterprise == 'true' || config.isCloud == 'true')
            "
            v-model="formData.custom_role"
            :label="t('user.customRole')"
            :options="filterdOption"
            class="showLabelOnTop tw:mt-2"
            multiple
            emit-value
            map-options
            stack-label
            dense
            borderless
            hide-bottom-space
            use-input
            @filter="filterFn"
            data-test="user-custom-role-field"
            :disable="filterdOption.length === 0"
          />
          <div v-if="beingUpdated" class="tw:mt-2">
            <q-toggle
              v-model="formData.change_password"
              :label="t('user.changePassword')"
              stack-label
              outlined
              filled
              hide-bottom-space
              class="o2-toggle-button-lg -tw:ml-4"
              size="lg"
              :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
              data-test="user-change-password-field"
            />

            <q-input
              v-if="
                formData.change_password &&
                (userRole == 'member' ||
                  store.state.userInfo.email == formData.email)
              "
              :type="isOldPwd ? 'password' : 'text'"
              v-model="formData.old_password"
              :label="t('user.oldPassword') + ' *'"
              class="showLabelOnTop tw:mt-2"
              stack-label
              dense
              borderless
              hide-bottom-space
              :rules="[
                (val: any) => !!val || 'Field is required',
                (val: any) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
              data-test="user-old-passoword-field"
            >
              <template v-slot:append>
                <q-icon
                  :name="isOldPwd ? 'visibility_off' : 'visibility'"
                  class="cursor-pointer"
                  @click="isOldPwd = !isOldPwd"
                />
              </template>
            </q-input>

            <q-input
              v-if="formData.change_password"
              :type="isNewPwd ? 'password' : 'text'"
              v-model="formData.new_password"
              :label="t('user.newPassword') + ' *'"
              class="showLabelOnTop tw:mt-2"
              stack-label
              dense
              hide-bottom-space
              borderless
              :rules="[
                (val: any) => !!val || 'Field is required',
                (val: any) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
              data-test="user-new-password-field"
            >
              <template v-slot:append>
                <q-icon
                  :name="isNewPwd ? 'visibility_off' : 'visibility'"
                  class="cursor-pointer"
                  @click="isNewPwd = !isNewPwd"
                />
              </template>
            </q-input>
          </div>
          <q-input
            v-if="
              !beingUpdated &&
              userRole != 'member' &&
              formData.organization == 'other'
            "
            v-model="formData.other_organization"
            :label="t('user.otherOrganization')"
            class="showLabelOnTop tw:mt-2"
            stack-label
            dense
            borderless
            hide-bottom-space
            :rules="[
              (val: any) =>
                /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(val) ||
                'Input must start with a letter and be alphanumeric _ or -',
            ]"
            maxlength="100"
          />

          <div class="flex justify-start tw:mt-6">
            <q-btn
              v-close-popup
              class="q-mr-md o2-secondary-button tw:h-[36px]"
              :label="t('user.cancel')"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              @click="$emit('cancel:hideform')"
              data-test="cancel-user-button"
            />
            <q-btn
              class="o2-primary-button no-border tw:h-[36px]"
              :label="t('user.save')"
              type="submit"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
              data-test="save-user-button"
            />
          </div>
        </q-form>
      </div>
    </q-card-section>
  </q-card>
  <q-dialog v-model="logout_confirm" persistent>
    <q-card>
      <q-card-section class="row items-center">
        <q-avatar icon="info" color="primary" text-color="white" />
        <span class="q-ml-sm"
          >As you've chosen to change your password, you'll be automatically
          logged out.</span
        >
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Ok" color="primary" @click="signout" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated, onBeforeMount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import userServiece from "@/services/users";
import {
  getImageURL,
  useLocalCurrentUser,
  useLocalUserInfo,
  invalidateLoginData,
} from "@/utils/zincutils";
import config from "@/aws-exports";
import { useReo } from "@/services/reodotdev_analytics";

const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "admin",
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
  props: {
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
  },
  emits: ["update:modelValue", "updated", "cancel:hideform"],
  setup(props) {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const q = useQuasar();
    const formData: any = ref(defaultValue());
    const existingUser = ref(true);
    const beingUpdated: any = ref(false);
    const userForm: any = ref(null);
    const isPwd: any = ref(true);
    const isNewPwd: any = ref(true);
    const isOldPwd: any = ref(true);
    let organizationOptions: any = ref([]);
    const loadingOrganizations = ref(true);
    const logout_confirm = ref(false);
    const loggedInUserEmail = ref(store.state.userInfo.email);
    const filterdOption = ref(props.customRoles);

    onActivated(() => {
      formData.value.organization = store.state.selectedOrganization.identifier;
    });

    onBeforeMount(() => setOrganizationOptions());

    watch(
      () => store.state.organizations,
      () => setOrganizationOptions(),
      { deep: true },
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

    return {
      t,
      q,
      store,
      router,
      formData,
      beingUpdated,
      userForm,
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
  created() {
    this.formData = { ...defaultValue, ...this.modelValue };
    this.beingUpdated = this.isUpdated;

    if (
      this.modelValue &&
      this.modelValue.email != undefined &&
      this.modelValue.email != ""
    ) {
      this.existingUser = false;
      this.beingUpdated = true;
      this.formData = { ...this.modelValue };
      this.formData.change_password = false;
      this.formData.password = "";
      if (config.isEnterprise == "true" || config.isCloud == true) {
        this.fetchUserRoles(this.modelValue.email);
      }
    }
  },
  methods: {
    signout() {
      if (config.isEnterprise == "true") {
        this.invalidateLoginData();
      }

      this.store.dispatch("logout");

      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);

      this.$router.push("/logout");
    },
    onSubmit() {
      const dismiss = this.q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

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
        userServiece
          .update(this.formData, selectedOrg, userEmail)
          .then((res: any) => {
            if (
              this.formData.change_password == true &&
              this.loggedInUserEmail === this.modelValue?.email
            ) {
              this.logout_confirm = true;
            } else {
              dismiss();
              this.formData.email = userEmail;
              this.$emit("updated", res.data, this.formData, "updated");
            }
          })
          .catch((err: any) => {
            this.q.notify({
              color: "negative",
              message: err.response.data.message,
              timeout: 2000,
            });
            dismiss();
            this.formData.email = userEmail;
          });
          this.track("Button Click", {
            button: "Update User",
            page: "Add User"
          });
      } else {
        if (this.existingUser) {
          const userEmail = this.formData.email;

          userServiece
            .updateexistinguser(
              {
                role: this.formData.role,
                custom_role: this.formData.custom_role,
              },
              selectedOrg,
              userEmail,
            )
            .then((res: any) => {
              dismiss();
              this.formData.email = userEmail;
              this.existingUser = true;
              this.$emit("updated", res.data, this.formData, "created");
              // }
            })
            .catch((err: any) => {
              if (err.response.data.code === 422) {
                // this.q.notify({
                //   color: "positive",
                //   type: 'positive',
                //   message: "User added successfully.",
                // });
                dismiss();
                this.existingUser = false;
              } else {
                this.q.notify({
                  color: "negative",
                  message: err.response.data.message,
                  timeout: 2000,
                });
                dismiss();
                this.formData.email = userEmail;
              }
            });
            this.track("Button Click", {
              button: "Update User",
              page: "Add User"
            });
        } else {
          userServiece
            .create(this.formData, selectedOrg)
            .then((res: any) => {
              dismiss();
              this.$emit("updated", res.data, this.formData, "created");
            })
            .catch((err: any) => {
              this.q.notify({
                color: "negative",
                message: err.response.data.message,
                timeout: 2000,
              });
              dismiss();
            });
            this.track("Button Click", {
              button: "Create User",
              page: "Add User"
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
