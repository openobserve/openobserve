<template>
    <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="flex">
          <q-btn no-caps color="primary" @click="goBack()" text-color="black" padding="xs" outline icon="arrow_back_ios_new" />
          <div class="text-h6 q-ml-md">
            Import Dashboard
          </div>
        </div>
      </div>
    </div>
    <q-separator class="q-my-sm"/>
    <div>
      <q-form @submit="onSubmit">
        <q-uploader
          label="Drag your json file here"
          accept=".json/*"
          style="max-width: 300px"
        ></q-uploader>

        <div class="flex q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold no-border"
            :label="t('function.cancel')"
            text-color="light-text"
            padding="sm md"
            color="accent"
            no-caps
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            :label="t('function.save')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
  </div>
</template>
<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getDashboard } from "../../utils/commons.ts";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

export default defineComponent({
  name: "Import Dashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore()
    const router = useRouter()
    const downloadDashboard = async () => {
      // get the dashboard
      const dashboard = await getDashboard(store, props.dashboardId)

      // prepare json and download via a click
      const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dashboard));
      const htmlA = document.createElement('a');
      htmlA.setAttribute("href", data);
      const fileName = dashboard.title || "dashboard"
      htmlA.setAttribute("download", fileName + ".dashboard.json");
      htmlA.click();
    }

    // back button to render dashboard List page
    const goBack = () => {
      return router.push("/dashboards");
    };

    const onSubmit = () => {

    }

    return {
      t,
      downloadDashboard,
      goBack,
      onSubmit
    }
  }
})
</script>
