<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-card class="full-height">
    <q-card-section class="q-px-sm q-py-sm">
      <div class="row items-center no-wrap">
        <div class="col">
          <div
            v-if="beingUpdated"
            class="text-body1 text-bold"
            data-test="update-userkey"
          >
            {{ t("settings.updateuserKey") }}
          </div>
          <div v-else class="text-body1 text-bold" data-test="create-userkey">
            {{ t("settings.addUserKeyTitle") }}
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup="true"
            round
            flat
            icon="img:/src/assets/images/common/close_icon.svg"
            @click="router.replace({ name: 'apiKeys' })"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator></q-separator>
    <q-card-section class="q-w-lg">
      <q-input
        v-if="beingUpdated"
        v-model="formData.id"
        :readonly="beingUpdated"
        :disabled="beingUpdated"
        :label="t('settings.id')"
      />
      <q-input
        v-model="formData.api_name"
        :placeholder="t('settings.apiNamePlaceHolder')"
        :label="t('settings.apiNamePlaceHolder') + '*'"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        :rules="[(val) => !!val]"
        data-test="userapi-name"
      />
      <div class="text-title text-bold">
        {{ t("settings.organizationLabel") }}
      </div>
      <q-option-group
        type="checkbox"
        v-model="formData.org_identifier"
        :dense="true"
        size="sm"
        :class="['q-mt-sm']"
        :options="organizationOptionList"
      ></q-option-group>

      <div class="flex justify-center q-mt-lg">
        <q-btn
          v-close-popup="true"
          class="q-mb-md text-bold"
          :label="t('settings.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="router.replace({ name: 'apiKeys' })"
        />
        <q-btn
          :disable="
            formData.org_identifier.length == 0 || formData.api_name == ''
          "
          :label="beingUpdated ? t('settings.update') : t('settings.save')"
          class="q-mb-md text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          type="submit"
          no-caps
          data-test="add-org"
          @click="generateUserKey()"
        />
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import organizationsService from "@/services/organizations";
import apiKeysService from "@/services/api_keys";

const defaultValue = () => {
  return {
    id: "",
    api_name: "",
    org_identifier: [],
  };
};

export default defineComponent({
  name: "AddUserKey",
  emits: ["listUserAPIKeys"],
  methods: {
    generateUserKey() {
      let apiCall;

      if (this.formData && this.formData.id) {
        apiCall = apiKeysService.updateUserAPIKey(this.formData);
      } else {
        apiCall = apiKeysService.createUserAPIKey(this.formData);
      }

      apiCall
        .then((response) => {
          this.formData = defaultValue();
          this.$emit("listUserAPIKeys");
          let notificationMessage = "User API Key Generated Successfully!";
          if (this.beingUpdated) {
            notificationMessage = "User API Key Updated Successfully!";
          }
          this.$q.notify({
            type: "positive",
            message: notificationMessage,
            timeout: 3000,
          });
          this.router.replace({ name: "apiKeys" });
        })
        .catch(() => {
          this.$emit("listUserAPIKeys");
          this.$q.notify({
            type: "negative",
            message: "Error while generating User API Key.",
            timeout: 3000,
          });
        });
    },
  },
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  created() {
    if (this.modelValue && this.modelValue.id) {
      this.beingUpdated = true;
      this.formData = {
        id: this.modelValue.id,
        api_name: this.modelValue.api_name,
        org_identifier: this.modelValue.org_identifier
          .replaceAll(" ", "")
          .split(","),
      };
    }
  },
  setup() {
    const store: any = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const organizationOptionList: any = ref([]);
    const selectedOrg = ref([]);
    const apiname = ref("");
    const formData: any = ref({
      id: "",
      api_name: "",
      org_identifier: [],
    });
    const beingUpdated = ref(false);

    onBeforeMount(() => {
      if (store.state.organizations.length > 0) {
        getOrganizationsList(store.state.organizations);
      } else {
        organizationsService
          .list(0, 100000, "name", false, "")
          .then((res: any) => {
            store.dispatch("setOrganizations", res.data.data);
            getOrganizationsList(res.data.data);
          });
      }
    });

    onUpdated(() => {
      formData.value = defaultValue();
    });

    const getOrganizationsList = (
      organizations: [{ name: any; identifier: any }]
    ) => {
      organizationOptionList.value = [];
      for (let i = 0; i < organizations.length; i++) {
        organizationOptionList.value.push({
          label: organizations[i].name,
          value: organizations[i].identifier,
        });
      }
    };

    return {
      t,
      store,
      router,
      organizationOptionList,
      selectedOrg,
      apiname,
      formData,
      beingUpdated,
    };
  },
});
</script>
