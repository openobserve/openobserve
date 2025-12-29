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
  <q-card class="o2-side-dialog column full-height">
    <q-card-section class=" q-py-md tw:w-full">
      <div class="row items-center no-wrap q-py-sm">
        <div class="col ">
          <div v-if="beingUpdated" style="font-size: 18px">
            {{ t("serviceAccounts.update") }}
          </div>
          <div v-else style="font-size: 18px">{{ t("serviceAccounts.add") }}</div>
        </div>
        <div class="col-auto">
          <q-icon
            data-test="add-service-account-close-dialog-btn"
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
          <q-input
            v-if="!beingUpdated"
            v-model="formData.email"
            :label="t('user.email') + ' *'"
            class="showLabelOnTop tw:mt-2"
            ref="email"
            stack-label
            hide-bottom-space
            borderless
            dense
            :rules="[
              (val: any, rules: any) =>
                rules.email(val) || 'Please enter a valid email address',
            ]"
          />

          <q-input
            v-model="firstName"
            :label="t('user.description')"
            class="showLabelOnTop tw:mt-2"
            ref="description"
            stack-label
            hide-bottom-space
            borderless
            dense
          />
          <div class="flex justify-start tw:mt-6">
            <q-btn
              v-close-popup="true"
              class="q-mr-md o2-secondary-button tw:h-[36px]"
              :label="t('user.cancel')"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              data-test="cancel-button"
              @click="$emit('cancel:hideform')"
            />
            <q-btn
              :label="t('user.save')"
              class="o2-primary-button no-border tw:h-[36px]"
              type="submit"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            />
          </div>
        </q-form>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { getImageURL } from "@/utils/zincutils";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";

const defaultValue: any = () => {
  return {
    org_member_id: "",
    role: "admin",
    first_name: "",
    email: "",
    organization: "",
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
  },
  emits: ["update:modelValue", "updated", "cancel:hideform"],
  setup(props) {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const $q = useQuasar();
    const formData: any = ref(defaultValue());
    const existingUser = ref(false);
    const beingUpdated: any = ref(false);
    const userForm: any = ref(null);
    let organizationOptions: any = ref([]);
    const loadingOrganizations = ref(true);
    const logout_confirm = ref(false);

    const firstName = ref(formData.value.first_name);

    onActivated(() => {
      formData.value.organization = store.state.selectedOrganization.identifier;
    });

    return {
      t,
      $q,
      store,
      router,
      formData,
      beingUpdated,
      userForm,
      organizationOptions,
      existingUser,
      getImageURL,
      loadingOrganizations,
      logout_confirm,
      firstName,
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
      this.beingUpdated = true;
      this.formData = { ...this.modelValue };
      this.firstName = this.modelValue?.first_name;
    }
  },
  methods: {
    onSubmit() {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      let selectedOrg = this.store.state.selectedOrganization.identifier;
      this.formData.organization =
        this.store.state.selectedOrganization.identifier;
      if (selectedOrg == "other") {
        selectedOrg = encodeURIComponent(this.formData.other_organization);
      }
      this.formData.first_name = this.firstName;
      if (this.beingUpdated) {
        const userEmail = this.formData.email;
        delete this.formData.email;
        service_accounts
          .update(this.formData, selectedOrg, userEmail)
          .then((res: any) => {
            this.formData.email = userEmail;
            this.$emit("updated", res.data, this.formData, "updated");
          })
          .catch((err: any) => {
            if (err.response?.status != 403) {
              if (err?.response?.data?.message) {
                this.$q.notify({
                  color: "negative",
                  message: err?.response?.data?.message,
                  timeout: 2000,
                });
              }
            }

            dismiss();
            this.formData.email = userEmail;
          });
          this.track("Button Click", {
            button: "Update Service Account",
            page: "Add Service Account"
          });
      } else {
          service_accounts
            .create(this.formData, selectedOrg)
            .then((res: any) => {
              dismiss();
              this.$emit("updated", res.data, this.formData, "created");
            })
            .catch((err: any) => {
              if(err.response?.status != 403){
                if(err?.response?.data?.message ) {
                  this.$q.notify({
                    color: "negative",
                    message: err?.response?.data?.message,
                    timeout: 2000,
                  });
                }
              }
              
              dismiss();
            });
          this.track("Button Click", {
            button: "Create Service Account",
            page: "Add Service Account"
          });
      }
    },
  },
});
</script>
