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
  <ODrawer data-test="add-update-organization-dialog"
    :open="open"
    :width="30"
    :title="beingUpdated ? t('organization.updateOrganization') : t('organization.createOrganization')"
    :primaryButtonLabel="t('organization.save')"
    :secondaryButtonLabel="t('organization.cancel')"
    :primaryButtonDisabled="organizationData.name === '' && !proPlanRequired"
    @click:primary="onSubmit"
    @click:secondary="$emit('update:open', false)"
    @update:open="$emit('update:open', $event)"
  >
    <div class="tw:p-4">
      <q-form ref="addOrganizationForm" @submit="onSubmit" lazy-rules="ondemand">
          <q-input
            v-if="beingUpdated"
            v-model="organizationData.id"
            :readonly="beingUpdated"
            :disabled="beingUpdated"
            stack-label
            borderless
            hide-bottom-space
            dense
            :label="t('organization.id')"
            class="showLabelOnTop tw:mt-2"
          />

          <q-input
            v-model.trim="organizationData.name"
            :label="t('organization.name') + '*'"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop tw:mt-2"
            stack-label
            borderless
            dense
            :rules="[
              (val: any) =>
                !!val
                  ? isValidOrgName ||
                    'Use alphanumeric characters, space and underscore only.'
                  : t('organization.nameRequired'),
            ]"
            data-test="org-name"
            maxlength="100"
            hide-bottom-space
          >
            <template v-slot:hint>
              Use alphanumeric characters, space and underscore only.
            </template>
          </q-input>

          <div class="flex justify-center q-mt-lg" v-if="proPlanRequired">
            <OButton
              variant="secondary"
              size="md"
              class="tw:mb-4 tw:ml-4"
              @click="completeSubscriptionProcess"
            >
              {{ t('organization.proceed_subscription') }}
            </OButton>
          </div>
        </q-form>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import organizationService from "@/services/organizations";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { useReo } from "@/services/reodotdev_analytics";
import { useQuasar } from "quasar";

const defaultValue = () => {
  return {
    id: "",
    name: "",
  };
};

let callOrganization: Promise<{ data: any }>;

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
    const beingUpdated: any = ref(false);
    const addOrganizationForm: any = ref(null);
    const disableColor: any = ref("");
    const organizationData: any = ref(defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const { track } = useReo();
    const q = useQuasar();

    const isValidOrgName = computed(() => {
      const orgNameRegex = /^[a-zA-Z0-9_ ]+$/;
      return orgNameRegex.test(organizationData.value.name);
    });

    watch(
      () => props.modelValue,
      (newVal) => {
        if (newVal && newVal.id) {
          beingUpdated.value = true;
          disableColor.value = "grey-5";
          organizationData.value = {
            id: newVal.id,
            name: newVal.name,
          };
        } else {
          beingUpdated.value = false;
          disableColor.value = "";
          organizationData.value = defaultValue();
        }
      },
      { deep: true, immediate: true },
    );

    return {
      t,
      router,
      disableColor,
      isPwd: ref(true),
      beingUpdated,
      organizationData,
      addOrganizationForm,
      store,
      isValidIdentifier,
      track,
      isValidOrgName,
    };
  },

  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.$q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },
    completeSubscriptionProcess() {
      // this.store.state.dispatch("setSelectedOrganization",)
      this.router.push(
        `/billings/plans?org_identifier=${this.newOrgIdentifier}`
      );
    },
    onSubmit() {
      this.organizationData.name = this.organizationData.name.trim();
      if(!this.isValidOrgName){
        return;
      }
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.addOrganizationForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        const organizationId = this.organizationData.id;
        //here we will check if organizationId is there or not because we only get org id when we are updating the organization
        //if organizationId is not there we will create a new organization else we will update the existing organization
        if (!organizationId) {
          delete this.organizationData.id;
          callOrganization = organizationService.create(this.organizationData);
        }
        else {
          callOrganization = organizationService.rename_organization(
            organizationId,
            this.organizationData.name,
          );
        }

        callOrganization
          .then((res: any) => {
            const data = res.data;
            if (res?.status == 200) {
              this.organizationData = {
                id: "",
                name: "",
              };

              // this.$emit("update:modelValue", data);
              this.$emit("updated");
              this.$emit("update:open", false);
              this.addOrganizationForm.resetValidation();
              dismiss();
            } else {
              this.proPlanRequired = true;
              this.proPlanMsg = res.data.message;
              this.newOrgIdentifier = res.data.identifier;
              // this.store.state.dispatch("setSelectedOrganization", {
              //   identifier: data.identifier,
              //   name: data.name,
              //   id: data.id,
              //   ingest_threshold: data.ingest_threshold,
              //   search_threshold: data.search_threshold,
              //   label: data.name,
              //   user_email: this.store.state.userInfo.email,
              //   subscription_type: "Free-Plan-USD-Monthly",
              // });
              // window.location.href = `/organizations?org_identifier=${data.data.identifier}&action=subscribe`;
              this.router.push({
                name: "organizations",
                query: {
                  org_identifier: data.data.identifier,
                  action: "subscribe",
                  update_org: Date.now(),
                },
              });
            }
          })
          .catch((err: any) => {
            this.$q.notify({
              type: "negative",
              message: JSON.stringify(
                err?.response?.data["message"] || ( organizationId ? "Organization Update failed." : "Organization creation failed.")
              ),
            });
            dismiss();
          });
          this.track("Button Click", {
            button: "Save Organization",
            page: "Add Organization"
          });
      });
    },
  },
});
</script>
