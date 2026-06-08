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
  <ODialog data-test="add-service-account-dialog"
    :open="open"
    size="sm"
    :title="beingUpdated ? t('serviceAccounts.update') : t('serviceAccounts.add')"
    :primaryButtonLabel="t('user.save')"
    :secondaryButtonLabel="t('user.cancel')"
    @click:primary="onSubmit"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <div>
          <OInput
            v-if="!beingUpdated"
            v-model="formData.email"
            :label="t('user.email') + ' *'"
            data-test="iam-add-service-account-email-input"
            class="showLabelOnTop tw:mt-2"
            :error="!!emailError"
            :error-message="emailError"
            @update:model-value="emailError = ''"
          />

          <OInput
            v-model="firstName"
            :label="t('user.description')"
            data-test="iam-add-service-account-description-input"
            class="showLabelOnTop tw:mt-2"
          />
        </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { getImageURL } from "@/utils/zincutils";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";

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
  components: { ODialog, OInput },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: Object,
      default: /* v8 ignore next */ () => defaultValue(), // prop default only invoked by Vue internally when prop is absent
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
    const formData: any = ref(defaultValue());
    const existingUser = ref(false);
    const beingUpdated: any = ref(false);
    const userForm: any = ref(null);
    let organizationOptions: any = ref([]);
    const loadingOrganizations = ref(true);
    const logout_confirm = ref(false);

    const firstName = ref(formData.value.first_name);
    const emailError = ref('');

    onActivated(() => {
      /* v8 ignore next */ // only runs under Vue keep-alive, not reachable in jsdom unit tests
      formData.value.organization = store.state.selectedOrganization.identifier;
    });

    watch(
      () => props.modelValue,
      (newVal) => {
        if (newVal && newVal.email) {
          beingUpdated.value = true;
          formData.value = { ...newVal };
          firstName.value = newVal.first_name ?? "";
        } else {
          beingUpdated.value = props.isUpdated;
          formData.value = defaultValue();
          formData.value.organization =
            store.state.selectedOrganization.identifier;
          firstName.value = "";
        }
      },
      { deep: true, immediate: true },
    );

    return {
      t,
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
      emailError,
    };
  },

  methods: {
    onSubmit() {
      if (!this.beingUpdated) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!this.formData.email || !emailRegex.test(this.formData.email)) {
          this.emailError = 'Please enter a valid email address';
          return;
        }
      }
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
              timeout: 0,
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
                toast({
                  message: err?.response?.data?.message,
                  variant: "error",
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
                  toast({
                    message: err?.response?.data?.message,
                    variant: "error",
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
