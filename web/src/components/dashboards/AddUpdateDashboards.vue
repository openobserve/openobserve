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
          <div v-if="beingUpdated" class="text-body1 text-bold text-dark">
            {{ t("dashboard.updatedashboard") }}
          </div>
          <div v-else class="text-body1 text-bold text-dark">
            {{ t("dashboard.createdashboard") }}
          </div>
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
    </q-card-section>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
      <q-form ref="adddashboardForm" @submit="onSubmit">
        <q-input
          v-if="beingUpdated"
          v-model="dashboardData.id"
          :readonly="beingUpdated"
          :disabled="beingUpdated"
          :label="t('dashboard.id')"
        />

        <q-input
          v-model="dashboardData.name"
          :placeholder="t('dashboard.nameHolder')"
          :label="t('dashboard.name') + '*'"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
        />
        <q-input
          v-model="dashboardData.type"
          :placeholder="t('dashboard.typeHolder')"
          :label="t('dashboard.typeDesc') + '*'"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
        />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold no-border"
            :label="t('dashboard.cancel')"
            text-color="light-text"
            padding="sm md"
            color="accent"
            no-caps
          />
          <q-btn
            :label="t('dashboard.save')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import dashboardService from "../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { isProxy, toRaw } from "vue";

const defaultValue = () => {
  return {
    id: "",
    name: "",
  };
};

let calldashboard: Promise<{ data: any }>;

export default defineComponent({
  name: "ComponentAddUpdateUser",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  emits: ["update:modelValue", "updated", "finish"],
  setup() {
    const store: any = useStore();
    const beingUpdated: any = ref(false);
    const adddashboardForm: any = ref(null);
    const disableColor: any = ref("");
    const dashboardData: any = ref(defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();

    function getRandInteger() {
      return Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100;
    }

    return {
      t,
      disableColor,
      isPwd: ref(true),
      beingUpdated,
      status,
      dashboardData,
      adddashboardForm,
      store,
      getRandInteger,
      isValidIdentifier,
    };
  },
  created() {
    if (this.modelValue && this.modelValue.id) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.dashboardData = {
        id: this.modelValue.id,
        name: this.modelValue.name,
      };
    }
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.$q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },
    onSubmit() {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.adddashboardForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        const dashboardId = this.dashboardData.id;
        delete this.dashboardData.id;

        if (dashboardId == "") {
          const baseObj = {
            title: "Experimental Dashboard 1",
            dashboardId: "Dash_ID1",
            description: "Monitoring Performance",
            role: "User Dashboard",
            owner: "abhattacharya",
            created: "2022-11-26T18:46:19Z",
            panels: [],
          };
          const obj = toRaw(this.dashboardData);
          baseObj.title = obj.name;
          baseObj.description = obj.type;
          baseObj.dashboardId = "DashID_" + this.getRandInteger();
          baseObj.created = new Date().toISOString();
          baseObj.owner =
            toRaw(this.store.state.currentuser.first_name) +
            " " +
            toRaw(this.store.state.currentuser.last_name);

          calldashboard = dashboardService.create(
            this.store.state.selectedOrganization.identifier,
            baseObj.dashboardId,
            JSON.stringify(JSON.stringify(baseObj))
          );
        }
        calldashboard.then((res: { data: any }) => {
          this.$emit("updated");
          console.log("Done saving");
        });
      });
    },
  },
});
</script>
