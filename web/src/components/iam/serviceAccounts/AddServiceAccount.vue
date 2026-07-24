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
    data-test="add-service-account-dialog"
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
        ref="saForm"
        :schema="addServiceAccountSchema"
        :default-values="addServiceAccountDefaults"
        @submit="onSubmit"
      >
        <OFormInput
          v-if="!beingUpdated"
          name="name"
          :label="t('serviceAccounts.form.name.label')"
          :placeholder="t('serviceAccounts.form.name.placeholder')"
          :help-text="t('serviceAccounts.form.name.help', { suffix: identifierSuffix })"
          required
          data-test="iam-add-service-account-name-input"
          class="showLabelOnTop mt-2"
        />

        <OFormInput
          name="first_name"
          :label="t('user.description')"
          data-test="iam-add-service-account-description-input"
          class="showLabelOnTop mt-2"
        />

        <!-- Access grants happen in the same flow (enterprise/cloud only — OSS
             has no roles/groups). Both pickers are optional; assignments are
             applied after the account is created, and failures surface in the
             token-reveal screen without blocking it. -->
        <template v-if="!beingUpdated && showAccessPickers">
          <OFormSelect
            name="roles"
            multiple
            :options="roleOptions"
            :label="t('serviceAccounts.form.roles.label')"
            data-test="iam-add-service-account-roles-select"
            class="showLabelOnTop mt-2"
          />
          <div class="mt-1 flex justify-end">
            <OButton
              variant="ghost"
              size="sm"
              icon-left="add"
              type="button"
              data-test="iam-add-service-account-create-role-btn"
              @click="showAddRoleDialog = true"
            >
              {{ t("serviceAccounts.form.roles.create") }}
            </OButton>
          </div>
          <OFormSelect
            name="groups"
            multiple
            :options="groupOptions"
            :label="t('serviceAccounts.form.groups.label')"
            data-test="iam-add-service-account-groups-select"
            class="showLabelOnTop mt-2"
          />
        </template>
      </OForm>
    </div>

    <!-- Inline role creation. Rendered INSIDE the ODialog slot so it inherits
         the dialog depth (provide/inject) and stacks one z-index tier above —
         a sibling placement would share this dialog's tier and its backdrop
         would not dim it. The freshly created role is appended to the options
         and auto-selected; the "Read-only" preset is seeded headlessly (see
         readonlyPreset.ts) so the role is usable without a trip to the Roles
         page. -->
    <AddRole v-model:open="showAddRoleDialog" @added:role="onRoleAdded" />
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import AddRole from "@/components/iam/roles/AddRole.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import service_accounts from "@/services/service_accounts";
import { getRoles, getGroups, updateRole, updateGroup } from "@/services/iam";
import { seedReadonlyRolePermissions } from "@/components/iam/roles/readonlyPreset";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import {
  makeAddServiceAccountSchema,
  maxServiceAccountNameLength,
  buildServiceAccountEmail,
  SERVICE_ACCOUNT_EMAIL_DOMAIN,
  type AddServiceAccountForm,
} from "./AddServiceAccount.schema";

const defaultValue: any = () => {
  return {
    first_name: "",
    email: "",
    organization: "",
  };
};

export default defineComponent({
  name: "ComponentAddUpdateUser",
  components: { ODialog, OForm, OFormInput, OFormSelect, OButton, AddRole },
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

    // Form-base: the OForm owns the only editable fields (name + first_name +
    // roles + groups). Update mode is derived from the externally-provided
    // modelValue (it carries an existing email) or the isUpdated flag.
    const beingUpdated = computed(() => !!props.modelValue?.email || props.isUpdated);

    const orgId = computed(() => store.state.selectedOrganization.identifier as string);

    // The stored identifier is `<name>.<org_id>@sa.internal` — shown in the
    // name field's help text so the user knows what they are creating.
    const identifierSuffix = computed(() =>
      `.${orgId.value}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`.toLowerCase(),
    );

    // Schema mode follows beingUpdated (name is create-only). The dialog body
    // remounts per open, so OForm always reads the correct variant at mount.
    const addServiceAccountSchema = computed(() =>
      makeAddServiceAccountSchema(beingUpdated.value, t, maxServiceAccountNameLength(orgId.value)),
    );

    // The OForm owns all editable fields. Name/roles/groups are always blank on
    // create; the description prefills from modelValue in update mode.
    const addServiceAccountDefaults = computed(
      (): AddServiceAccountForm => ({
        name: "",
        first_name: props.modelValue?.first_name ?? "",
        roles: [],
        groups: [],
      }),
    );

    // Roles/groups exist only on enterprise/cloud (OSS has no RBAC UI).
    const showAccessPickers = computed(
      () => config.isEnterprise === "true" || config.isCloud === "true",
    );

    const roleOptions = ref<SelectOption[]>([]);
    const groupOptions = ref<SelectOption[]>([]);
    const showAddRoleDialog = ref(false);

    // Both list APIs return plain string arrays. A load failure leaves the
    // pickers empty but never blocks account creation.
    const loadAccessOptions = async () => {
      if (!showAccessPickers.value) return;
      try {
        const [rolesRes, groupsRes] = await Promise.all([
          getRoles(orgId.value),
          getGroups(orgId.value),
        ]);
        roleOptions.value = (rolesRes.data ?? []).map((role: string) => ({
          label: role,
          value: role,
        }));
        groupOptions.value = (groupsRes.data ?? []).map((group: string) => ({
          label: group,
          value: group,
        }));
      } catch (err) {
        console.error("Failed to load roles/groups for service account form", err);
      }
    };

    watch(
      () => props.open,
      (open) => {
        if (open && !beingUpdated.value) loadAccessOptions();
      },
      { immediate: true },
    );

    return {
      t,
      store,
      beingUpdated,
      identifierSuffix,
      addServiceAccountSchema,
      addServiceAccountDefaults,
      showAccessPickers,
      roleOptions,
      groupOptions,
      showAddRoleDialog,
      track,
    };
  },

  methods: {
    // A role created inline (AddRole emits `added:role` after a successful
    // createRole) is appended to the picker options and auto-selected in the
    // form. Writing through the exposed TanStack form keeps the OForm as the
    // single source of truth — no mirror ref. The "Read-only" preset is then
    // seeded headlessly (in EditRole the seeding happens on-page via
    // `?preset=readonly`, which never fires in this embedded flow) so the new
    // role has usable rights without a separate trip to the Roles UI. A
    // seeding failure downgrades to a warning — the role still exists and is
    // still selected; only its permissions need to be granted manually.
    async onRoleAdded({ role_name, startFrom }: { role_name: string; startFrom?: string }) {
      if (!this.roleOptions.some((o: any) => o.value === role_name)) {
        this.roleOptions.push({ label: role_name, value: role_name });
      }
      const form = (this.$refs.saForm as any)?.form;
      if (form) {
        const current: string[] = form.state.values.roles ?? [];
        if (!current.includes(role_name)) {
          form.setFieldValue("roles", [...current, role_name]);
        }
      }

      if (startFrom === "readonly") {
        const organization = this.store.state.selectedOrganization.identifier;
        const isMetaOrg = organization === this.store.state.zoConfig?.meta_org;
        try {
          const granted = await seedReadonlyRolePermissions(role_name, organization, isMetaOrg);
          // Zero applicable grants means the role is still empty — say so
          // instead of claiming success.
          if (granted > 0) {
            toast({
              message: this.t("serviceAccounts.form.roles.readonlySeeded", {
                role: role_name,
              }),
              variant: "success",
            });
          } else {
            toast({
              message: this.t("serviceAccounts.form.roles.readonlySeedFailed", {
                role: role_name,
              }),
              variant: "warning",
            });
          }
        } catch (err) {
          console.error("Failed to seed read-only permissions", err);
          toast({
            message: this.t("serviceAccounts.form.roles.readonlySeedFailed", {
              role: role_name,
            }),
            variant: "warning",
          });
        }
      }
    },

    // Plain async @submit handler — fires only after the schema passes (name
    // required + slug in create mode). Awaited by OForm, so the footer Save
    // spinner spans the create + the role/group assignment fan-out. The request
    // body is built here from the @submit `value` plus the non-form context
    // (org from the store; the existing record from modelValue).
    async onSubmit(value: AddServiceAccountForm) {
      const organization = this.store.state.selectedOrganization.identifier;

      if (this.beingUpdated) {
        // Round-trip the existing record (minus email, which is passed
        // separately) with the edited description.
        const { email: userEmail, ...rest } = this.modelValue ?? {};
        const payload: any = { ...rest, organization, first_name: value.first_name };
        try {
          const res = await service_accounts.update(payload, organization, userEmail);
          this.$emit("updated", res.data, { ...payload, email: userEmail }, "updated");
          this.$emit("update:open", false);
        } catch (err: any) {
          // Always surface something — a message-less failure (network error,
          // plain-text body) must not leave the dialog silently open.
          if (err.response?.status != 403) {
            toast({
              message: err?.response?.data?.message || this.t("serviceAccounts.updateFailed"),
              variant: "error",
            });
          }
        }
        this.track("Button Click", {
          button: "Update Service Account",
          page: "Add Service Account",
        });
      } else {
        // The UI synthesizes the org-scoped identifier from the name; the API
        // still receives a regular email payload.
        const email = buildServiceAccountEmail(value.name, organization);
        try {
          const res = await service_accounts.create(
            { email, first_name: value.first_name },
            organization,
          );

          // Fan out access grants AFTER the account exists — but do NOT await
          // them here: the show-once token must never be held hostage by a
          // slow or hanging grant request. The unresolved promise rides along
          // with the created event; the token screen shows the outcome (or a
          // pending line) when it settles. applyAccessGrants never rejects —
          // partial failures are collected into the resolved buckets.
          const accessPromise = this.applyAccessGrants(
            email,
            organization,
            value.roles,
            value.groups,
          );

          this.$emit(
            "updated",
            res.data,
            { email, first_name: value.first_name, organization },
            "created",
            accessPromise,
          );
          this.$emit("update:open", false);
        } catch (err: any) {
          // Always surface something — a message-less failure (network error,
          // plain-text body) must not leave the dialog silently open.
          if (err.response?.status != 403) {
            toast({
              message: err?.response?.data?.message || this.t("serviceAccounts.createFailed"),
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

    // Adds the freshly created account to each selected role and group.
    // Returns { assigned, failed } buckets; never throws.
    async applyAccessGrants(
      email: string,
      organization: string,
      roles: string[],
      groups: string[],
    ) {
      const assigned = { roles: [] as string[], groups: [] as string[] };
      const failed = { roles: [] as string[], groups: [] as string[] };

      const [roleResults, groupResults] = await Promise.all([
        Promise.allSettled(
          roles.map((role) =>
            updateRole({
              role_id: role,
              org_identifier: organization,
              payload: {
                add: [],
                remove: [],
                add_users: [email],
                remove_users: [],
              },
            }),
          ),
        ),
        Promise.allSettled(
          groups.map((group) =>
            updateGroup({
              group_name: group,
              org_identifier: organization,
              payload: {
                add_roles: [],
                remove_roles: [],
                add_users: [email],
                remove_users: [],
              },
            }),
          ),
        ),
      ]);

      roleResults.forEach((result, i) => {
        (result.status === "fulfilled" ? assigned : failed).roles.push(roles[i]);
      });
      groupResults.forEach((result, i) => {
        (result.status === "fulfilled" ? assigned : failed).groups.push(groups[i]);
      });

      return { assigned, failed };
    },
  },
});
</script>
