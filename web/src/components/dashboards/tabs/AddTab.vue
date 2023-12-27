<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-card class="column full-height">
    <q-card-section class="q-px-md q-py-md">
      <div class="row items-center no-wrap">
        <div class="col">
          <div v-if="editMode" class="text-body1 text-bold">Edit Tab</div>
          <div v-else class="text-body1 text-bold">Add Tab</div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup="true" round flat icon="cancel" />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
      <q-form ref="addTabForm" @submit.stop="onSubmit.execute">
        <q-input
          v-model="tabData.name"
          label="Name*"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val) => !!val.trim() || t('dashboard.nameRequired')]"
          :lazy-rules="true"
        />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup="true"
            class="q-mb-md text-bold"
            :label="t('dashboard.cancel')"
            text-color="light-text"
            padding="sm md"
            no-caps
          />
          <q-btn
            data-test="dashboard-add-submit"
            :disable="tabData.name.trim() === ''"
            :loading="onSubmit.isLoading.value"
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useLoading } from "@/composables/useLoading";

const defaultValue = () => {
  return {
    name: "",
    panels: [],
  };
};

export default defineComponent({
  name: "AddTab",
  props: {
    tabIndex: {
      type: Number,
      default: -1,
    },
    editMode: {
      type: Boolean,
      default: false,
    },
    dashboardData: {
      type: Object,
      required: true,
    },
  },
  emits: ["saveDashboard"],
  setup(props, { emit }) {
    const store: any = useStore();
    const addTabForm: any = ref(null);
    const tabData: any = ref(
      props.editMode
        ? JSON.parse(JSON.stringify(props?.dashboardData?.tabs[props.tabIndex]))
        : defaultValue()
    );
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const $q = useQuasar();

    const onSubmit = useLoading(async () => {
      await addTabForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        try {
          //if edit mode
          if (props.editMode) {
            props.dashboardData.tabs[props.tabIndex] = tabData.value;
            emit("saveDashboard");
            $q.notify({
              type: "positive",
              message: "Tab updated",
              timeout: 2000,
            });
          }
          //else new tab
          else {
            props?.dashboardData?.tabs?.push(tabData.value);
            emit("saveDashboard");
            $q.notify({
              type: "positive",
              message: `Tab added successfully.`,
              timeout: 2000,
            });
          }
        } catch (err: any) {
          console.log("err", err);

          $q.notify({
            type: "negative",
            message: JSON.stringify(
              err?.response?.data["error"] || "Tab creation failed."
            ),
            timeout: 2000,
          });
        } finally {
          tabData.value = {
            name: "",
            panels: [],
          };
          await addTabForm.value.resetValidation();
        }
      });
    });

    return {
      t,
      tabData,
      addTabForm,
      store,
      isValidIdentifier,
      onSubmit,
    };
  },
});
</script>
