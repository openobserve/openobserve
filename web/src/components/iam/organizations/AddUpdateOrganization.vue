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
  <ODialog data-test="add-update-organization-dialog"
    :open="open"
    size="sm"
    :title="beingUpdated ? t('organization.updateOrganization') : t('organization.createOrganization')"
    :primaryButtonLabel="t('organization.save')"
    :secondaryButtonLabel="t('organization.cancel')"
    form-id="add-update-organization-form"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <OForm
        id="add-update-organization-form"
        :schema="addUpdateOrganizationSchema"
        :default-values="addUpdateOrganizationDefaults"
        @submit="onSubmit"
      >
        <OFormInput
          v-if="beingUpdated"
          name="id"
          readonly
          disabled
          :label="t('organization.id')"
          class="showLabelOnTop mt-2"
        />

        <OFormInput
          name="name"
          :label="t('organization.name')"
          required
          class="showLabelOnTop mt-2"
          :help-text="t('organization.nameHelpText')"
          data-test="org-name"
          maxlength="100"
        />

        <OFormCheckbox
          v-if="!beingUpdated && config.isCloud == 'true' && canMakeBilledMember"
          name="makeBilledMember"
          :label="t('organization.makeBilledMember', { org: currentOrgName })"
          class="mt-4"
          data-test="org-make-billed-member"
        />

        <div class="flex justify-center mt-4" v-if="proPlanRequired">
          <OButton
            variant="secondary"
            size="md"
            class="mb-4 ml-4"
            @click="completeSubscriptionProcess"
          >
            {{ t('organization.proceed_subscription') }}
          </OButton>
        </div>
      </OForm>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import organizationService from "@/services/organizations";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeAddUpdateOrganizationSchema,
  type AddUpdateOrganizationForm,
} from "./AddUpdateOrganization.schema";

const defaultValue = () => {
  return {
    id: "",
    name: "",
  };
};

export default defineComponent({
  name: "ComponentAddUpdateUser",
  components: { OButton, OFormCheckbox, ODialog, OForm, OFormInput },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  data() {
    return {
      proPlanRequired: false,
      proPlanMsg: "",
      newOrgIdentifier: "",
    };
  },
  emits: ["update:modelValue", "updated", "finish", "update:open"],
  setup(props) {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const { track } = useReo();

    const addUpdateOrganizationSchema = makeAddUpdateOrganizationSchema(t);

    // Update mode is derived from the externally-provided modelValue (it carries
    // an `id` only for an existing organization).
    const beingUpdated = computed(() => !!props.modelValue?.id);

    // The OForm owns id/name/makeBilledMember. This typed computed seeds them each
    // time the dialog body mounts (edit → id + name from modelValue, create →
    // blank); makeBilledMember always starts unchecked.
    const addUpdateOrganizationDefaults = computed(
      (): AddUpdateOrganizationForm => ({
        id: props.modelValue?.id ?? "",
        name: props.modelValue?.name ?? "",
        makeBilledMember: false,
      }),
    );

    const currentOrgName = computed(
      () =>
        store.state.selectedOrganization?.name ||
        store.state.selectedOrganization?.identifier ||
        "",
    );

    // Only orgs listed in billing_group_allowed_orgs (comma-separated, from
    // config) can act as a payer org, so the checkbox is shown only for them.
    const canMakeBilledMember = computed(() => {
      const allowed = (store.state.zoConfig?.billing_group_allowed_orgs || "")
        .split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);
      return allowed.includes(store.state.selectedOrganization?.identifier);
    });

    // Options-API: the schema (and the defaults computed) MUST be returned from
    // setup() — a bare module import is out of the template's scope, so :schema
    // would resolve to undefined and validation would silently no-op.
    return {
      t,
      router,
      beingUpdated,
      addUpdateOrganizationSchema,
      addUpdateOrganizationDefaults,
      store,
      track,
      config,
      currentOrgName,
      canMakeBilledMember,
    };
  },

  methods: {
    completeSubscriptionProcess() {
      this.router.push(
        `/billings/plans?org_identifier=${this.newOrgIdentifier}`,
      );
    },
    // Plain async @submit handler — fires only after the schema passes (name
    // required + regex). Awaited by OForm, so the footer Save spinner spans the
    // request automatically.
    async onSubmit(value: AddUpdateOrganizationForm) {
      const name = value.name.trim();
      const organizationId = value.id;
      // here we will check if organizationId is there or not because we only get
      // org id when we are updating the organization: no id → create, else rename.
      let callOrganization: Promise<{ data: any; status?: number }>;
      if (!organizationId) {
        const payload: any = { name };
        if (value.makeBilledMember && config.isCloud == "true") {
          payload.make_billed_member_of =
            this.store.state.selectedOrganization.identifier;
        }
        callOrganization = organizationService.create(payload);
      } else {
        callOrganization = organizationService.rename_organization(
          organizationId,
          name,
        );
      }

      try {
        const res: any = await callOrganization;
        const data = res.data;
        if (res?.status == 200) {
          this.$emit("updated");
          this.$emit("update:open", false);
        } else {
          this.proPlanRequired = true;
          this.proPlanMsg = res.data.message;
          this.newOrgIdentifier = res.data.identifier;
          this.router.push({
            name: "organizations",
            query: {
              org_identifier: data.data.identifier,
              action: "subscribe",
              update_org: Date.now(),
            },
          });
        }
      } catch (err: any) {
        toast({
          variant: "error",
          message: JSON.stringify(
            err?.response?.data["message"] ||
              (organizationId
                ? this.t("iam.addUpdateOrganization.updateFailed")
                : this.t("iam.addUpdateOrganization.createFailed")),
          ),
        });
      }

      this.track("Button Click", {
        button: "Save Organization",
        page: "Add Organization",
      });
    },
  },
});
</script>
