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
  <ODrawer data-test="add-service-account-dialog"
    :open="open"
    size="lg"
    :title="beingUpdated ? t('serviceAccounts.update') : t('serviceAccounts.add')"
    @update:open="$emit('update:open', $event)"
  >
    <div class="tw:p-4">
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
          <div class="flex justify-start tw:mt-6 tw:gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="cancel-button"
              @click="$emit('update:open', false)"
            >
              {{ t('user.cancel') }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              type="submit"
            >
              {{ t('user.save') }}
            </OButton>
          </div>
        </q-form>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
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
  components: { OButton, ODrawer },
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
  },
  emits: ["update:modelValue", "updated", "update:open"],
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
              this.$emit("update:open", false);
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
              this.$emit("update:open", false);
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
