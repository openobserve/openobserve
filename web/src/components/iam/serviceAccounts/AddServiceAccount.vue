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
    form-id="add-service-account-form"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <OForm
        id="add-service-account-form"
        :schema="addServiceAccountSchema"
        :default-values="addServiceAccountDefaults"
        @submit="onSubmit"
      >
        <OFormInput
          v-if="!beingUpdated"
          name="email"
          :label="t('serviceAccounts.form.identifier.label')"
          :placeholder="t('serviceAccounts.form.identifier.placeholder')"
          :help-text="t('serviceAccounts.form.identifier.help')"
          required
          data-test="iam-add-service-account-identifier-input"
          class="showLabelOnTop mt-2"
        />

        <OFormInput
          name="first_name"
          :label="t('user.description')"
          data-test="iam-add-service-account-description-input"
          class="showLabelOnTop mt-2"
        />
      </OForm>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeAddServiceAccountSchema,
  type AddServiceAccountForm,
} from "./AddServiceAccount.schema";

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
  components: { ODialog, OForm, OFormInput },
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
    const { t } = useI18n();
    const { track } = useReo();

    // Form-base: the OForm owns the only editable fields (email + first_name).
    // Update mode is derived from the externally-provided modelValue (it carries
    // an existing email) or the isUpdated flag — no mirrored formData needed.
    const beingUpdated = computed(
      () => !!props.modelValue?.email || props.isUpdated,
    );

    // Schema mode follows beingUpdated (email is create-only). The dialog body
    // remounts per open, so OForm always reads the correct variant at mount.
    const addServiceAccountSchema = computed(() =>
      makeAddServiceAccountSchema(beingUpdated.value, t),
    );

    // The OForm owns email + first_name. Email is always blank on create; the
    // description prefills from the externally-provided modelValue in update mode.
    const addServiceAccountDefaults = computed((): AddServiceAccountForm => ({
      email: "",
      first_name: props.modelValue?.first_name ?? "",
    }));

    return {
      t,
      store,
      beingUpdated,
      addServiceAccountSchema,
      addServiceAccountDefaults,
      track,
    };
  },

  methods: {
    // Plain async @submit handler — fires only after the schema passes (email
    // required + valid in create mode). Awaited by OForm, so the footer Save
    // spinner spans the request automatically (no manual loading toast). The
    // request body is built here from the @submit `value` (the editable fields)
    // plus the non-form context (org from the store; the existing record from
    // modelValue) — no `formData` mirror.
    async onSubmit(value: AddServiceAccountForm) {
      const organization = this.store.state.selectedOrganization.identifier;

      if (this.beingUpdated) {
        // Round-trip the existing record (minus email, which is passed
        // separately) with the edited description.
        const { email: userEmail, ...rest } = this.modelValue;
        const payload: any = { ...rest, organization, first_name: value.first_name };
        try {
          const res = await service_accounts.update(
            payload,
            organization,
            userEmail,
          );
          this.$emit("updated", res.data, { ...payload, email: userEmail }, "updated");
          this.$emit("update:open", false);
        } catch (err: any) {
          if (err.response?.status != 403 && err?.response?.data?.message) {
            toast({
              message: err?.response?.data?.message,
              variant: "error",
            });
          }
        }
        this.track("Button Click", {
          button: "Update Service Account",
          page: "Add Service Account",
        });
      } else {
        const payload: any = {
          org_member_id: "",
          role: "admin",
          organization,
          email: value.email,
          first_name: value.first_name,
        };
        try {
          const res = await service_accounts.create(payload, organization);
          this.$emit("updated", res.data, payload, "created");
          this.$emit("update:open", false);
        } catch (err: any) {
          if (err.response?.status != 403 && err?.response?.data?.message) {
            toast({
              message: err?.response?.data?.message,
              variant: "error",
            });
          }
        }
        this.track("Button Click", {
          button: "Create Service Account",
          page: "Add Service Account",
        });
      }
    },
  },
});
</script>
