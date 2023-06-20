<template>
    <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="flex">
          <q-btn no-caps @click="goBack()"  padding="xs" outline icon="arrow_back_ios_new" />
          <div class="text-h6 q-ml-md">
            Import Dashboard
          </div>
        </div>
      </div>
    </div>
    <q-separator class="q-my-sm"/>
    <div>
      <q-form @submit="onSubmit">
        <div class="q-my-md">
          Import Dashboard from exported JSON file
        </div>
        <div style="width: 400px; height: 100px;">
          <q-file filled bottom-slots v-model="jsonFile" label="Drop your file here" accept=".json">
            <template v-slot:prepend>
              <q-icon name="cloud_upload" @click.stop.prevent />
            </template>
            <template v-slot:append>
              <q-icon name="close" @click.stop.prevent="jsonFile = null" class="cursor-pointer" />
            </template>

            <template v-slot:hint>
              .json files only
            </template>
          </q-file>
        </div>

        <div class="flex q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold no-border"
            :label="t('function.cancel')"
            text-color="light-text"
            padding="sm md"
            color="accent"
            no-caps
            @click="goBack()"
          />
          <q-btn
            :disable="!jsonFile"
            :label="t('dashboard.import')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
            @click="importFile()"
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
import { getAllDashboards } from "../../utils/commons.ts";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import dashboardService from "../../services/dashboards";

export default defineComponent({
  name: "Import Dashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore()
    const router = useRouter()
    const jsonFile = ref<any>()
    const $q = useQuasar();

    const importFile = async () => {
      // get the dashboard
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      var reader = new FileReader();
      reader.onload = function() {
        try {
          const data = JSON.parse(reader.result)

          dashboardService.create(
            store.state.selectedOrganization.identifier,
            data
          ).then((res: { data: any }) => {
              jsonFile.value = null
              dismiss();
              $q.notify({
                type: "positive",
                message: `Dashboard Imported Successfully`,
              });
            })
            .then(() => {
              return getAllDashboards(store)
            }).then(()=> {
              router.push('/dashboards')
            })
            .catch((err: any) => {
              console.log(err)
              $q.notify({
                type: "negative",
                message: err?.response?.data["error"] ? JSON.stringify(err?.response?.data["error"]) : 'Dashboard import failed',
              });
              dismiss();
            });

          dismiss();
        } catch (error) {
          
          $q.notify({
              type: "negative",
              message: 'Invalid JSON format',
            });
            dismiss();
        }
      };
      reader.readAsText(jsonFile.value);
    }

    // back button to render dashboard List page
    const goBack = () => {
      return router.push("/dashboards");
    };

    const onSubmit = () => {
      // do nothing here
    }

    return {
      t,
      goBack,
      onSubmit,
      importFile,
      jsonFile
    }
  }
})
</script>
