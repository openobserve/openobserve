<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-card class="column full-height">
    <q-card-section class="q-px-md q-py-md text-black">
      <div class="row items-center no-wrap">
        <div class="col">
          <div v-if="beingUpdated" class="text-h6">
            {{ t("user.editUser") }}
          </div>
          <div v-else class="text-h6">{{ t("user.add") }}</div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup
            round
            flat
            icon="img:/src/assets/images/common/close_icon.svg"
          />
        </div>
      </div>

      <q-separator />
      <div>
        <q-form ref="updateUserForm" @submit.prevent="onSubmit">
          <q-input
            v-if="!beingUpdated"
            v-model="formData.email"
            :label="t('user.email') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[
              (val, rules) =>
                rules.email(val) || 'Please enter a valid email address',
            ]"
          />

          <div v-if="!beingUpdated">
            <q-input
              :type="isPwd ? 'password' : 'text'"
              v-model="formData.password"
              :label="t('user.password') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[
                (val) => !!val || 'Field is required',
                (val) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
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
            v-model="formData.firstName"
            :label="t('user.firstName')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop q-mt-sm"
            stack-label
            outlined
            filled
            dense
          />

          <q-input
            v-model="formData.lastName"
            :label="t('user.lastName')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
          />

          <q-select
            v-if="
              userRole !== 'member' &&
              store.state.userInfo.email !== formData.email
            "
            v-model="formData.role"
            :label="t('user.role') + ' *'"
            :options="roleOptions"
            color="input-border"
            bg-color="input-bg"
            class="q-pt-md q-pb-sm showLabelOnTop"
            stack-label
            outlined
            filled
            dense
          />

          <div v-if="beingUpdated">
            <q-toggle
              v-model="formData.change_password"
              :label="t('user.changePassword')"
              color="input-border"
              bg-color="input-bg"
              class="q-pt-md q-pb-sm showLabelOnTop"
              stack-label
              outlined
              filled
              dense
            />

            <q-input
              v-if="
                formData.change_password &&
                (userRole == 'member' ||
                  store.state.userInfo.email == formData.email)
              "
              :type="isOldPwd ? 'password' : 'text'"
              v-model="formData.oldPassword"
              :label="t('user.oldPassword') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[
                (val) => !!val || 'Field is required',
                (val) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
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
              v-model="formData.newPassword"
              :label="t('user.newPassword') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[
                (val) => !!val || 'Field is required',
                (val) =>
                  (val && val.length >= 8) ||
                  'Password must be at least 8 characters long',
              ]"
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

          <div class="flex justify-center q-mt-lg">
            <q-btn
              v-close-popup
              class="q-mb-md text-bold no-border"
              :label="t('user.cancel')"
              text-color="light-text"
              padding="sm md"
              color="accent"
              no-caps
            />
            <q-btn
              :label="t('user.save')"
              class="q-mb-md text-bold no-border q-ml-md"
              color="secondary"
              padding="sm xl"
              type="submit"
              no-caps
            />
          </div>
        </q-form>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import userServiece from "../../services/users";

const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "admin",
    firstName: "",
    lastName: "",
    email: "",
    oldPassword: "",
    newPassword: "",
    change_password: false,
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
      default: "member",
    },
  },
  emits: ["update:modelValue", "updated"],
  setup() {
    const store: any = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const formData: any = ref(defaultValue());
    const roleOptions = ["admin", "member"];
    const beingUpdated: any = ref(false);
    const userForm: any = ref(null);
    const isPwd: any = ref(true);
    const isNewPwd: any = ref(true);
    const isOldPwd: any = ref(true);

    return {
      t,
      $q,
      store,
      formData,
      beingUpdated,
      userForm,
      roleOptions,
      isPwd,
      isNewPwd,
      isOldPwd,
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
      this.beingUpdated = true;
      this.formData = this.modelValue;
      this.formData.change_password = false;
      this.formData.password = "";
    }
  },
  methods: {
    onSubmit() {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      this.formData.name =
        this.formData.firstName.trim() + this.formData.lastName.trim() != ""
          ? this.formData.firstName + " " + this.formData.lastName
          : "";

      if (this.beingUpdated) {
        const userEmail = this.formData.email;
        delete this.formData.email;

        if (this.formData.change_password == false) {
          delete this.formData.oldPassword;
          delete this.formData.newPassword;
        }
        userServiece
          .update(
            this.formData,
            this.store.state.selectedOrganization.identifier,
            userEmail
          )
          .then((res: any) => {
            dismiss();
            this.formData.email = userEmail;
            this.$emit("updated", res.data, this.formData, "updated");
          });
      } else {
        userServiece
          .create(
            this.formData,
            this.store.state.selectedOrganization.identifier
          )
          .then((res: any) => {
            dismiss();
            this.$emit("updated", res.data, this.formData, "created");
          });
      }
    },
  },
});
</script>
