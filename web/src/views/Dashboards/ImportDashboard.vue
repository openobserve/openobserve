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
  <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="flex">
          <q-btn no-caps @click="goBack()" padding="xs" outline icon="arrow_back_ios_new" />
          <div class="text-h6 q-ml-md">
            Import Dashboard
          </div>
        </div>
      </div>
    </div>
    <q-separator class="q-my-sm" />
    <div style="width: 400px;">
      <q-form @submit="onSubmit">
        <div class="q-my-md">
          Import Dashboard from exported JSON file
        </div>
        <div style="width: 400px;">
          <q-file filled bottom-slots v-model="jsonFile" label="Drop your file here" accept=".json" multiple>
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
          <div>
            <q-btn :disable="!jsonFile" :label="t('dashboard.import')" class="q-my-md text-bold no-border"
              color="secondary" padding="sm xl" type="submit" no-caps @click="importFile()" />
          </div>
        </div>
      </q-form>
      <q-separator class="q-my-sm" />
      <q-form @submit="onSubmit">
        <div class="q-my-md">
          Import Dashboard from URL
        </div>
        <div class="flex" style="width: 400px;">
          <q-input v-model="url" style="width:275px;" label="Add your url" color="input-border" bg-color="input-bg" stack-label filled dense
            label-slot />
          <div>
            <q-btn :disable="!url" class="text-bold no-border q-ml-md" :label="t('dashboard.import')"
              color="secondary" type="submit" no-caps @click="importFromUrl()" padding="sm xl" />
          </div>
        </div>
      </q-form>
      <q-separator class="q-my-sm" />
      <q-form @submit="onSubmit">
        <div class="q-my-md">
          Import Dashboard from JSON
        </div>
        <div style="width: 400px;" class="flex">
          <q-input v-model="jsonStr" style="width: 400px;" label="JSON Object" color="input-border" dense filled type="textarea" />
        </div>
        <div class="q-my-md">
          <q-btn :disable="!jsonStr" class="text-bold no-border q-mr-md" :label="t('dashboard.import')"
            color="secondary" type="submit" padding="sm xl" no-caps @click="importFromJsonStr()" />
          <q-btn v-close-popup class="text-bold" :label="t('function.cancel')" text-color="light-text" padding="sm xl"
            no-caps @click="goBack()" />
        </div>
      </q-form>
    </div>
    <div>

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
import axios from 'axios';

export default defineComponent({
  name: "Import Dashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore()
    const router = useRouter()
    const jsonFile = ref<any>()
    const url = ref('')
    const jsonStr = ref('')
    const $q = useQuasar();

    const importFile = async () => {
      console.log("===",jsonFile.value);
      
      jsonFile.value.map((it:any)=>{
        let reader = new FileReader();
        reader.onload = function (readerResult) {
          importDashboardFromJSON(readerResult.target.result)
            .then(() => {
              jsonFile.value = null
            })
        };
        reader.readAsText(it)
        })
     
    }

    const importDashboardFromJSON = (jsonObj: any) => {
      console.log("---", jsonObj);

      // get the dashboard
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      try {
        const data = typeof jsonObj == 'string' ? JSON.parse(jsonObj) : typeof jsonObj == 'object' ? jsonObj : jsonObj

        console.log("try: data", data);

        //set owner name and creator name to import dashboard
        data.owner = store.state.userInfo.name
        data.created = new Date().toISOString()

        return dashboardService.create(
          store.state.selectedOrganization.identifier,
          data
        ).then((res: { data: any }) => {
          dismiss();
          $q.notify({
            type: "positive",
            message: `Dashboard Imported Successfully`,
          });
        })
          .then(() => {
            return getAllDashboards(store)
          }).then(() => {
            router.push('/dashboards')
          })
          .catch((err: any) => {
            console.log(err)
            $q.notify({
              type: "negative",
              message: err?.response?.data["error"] ? JSON.stringify(err?.response?.data["error"]) : 'Dashboard import failed',
            });
            dismiss();
          }).finally(() => {
            dismiss();
          });
      } catch (error) {
        console.log(error);

        $q.notify({
          type: "negative",
          message: 'Invalid JSON format',
        });
        dismiss();
      }
    }
    const importFromUrl = async () => {
      // get the dashboard
      const urlData = url.value ? url.value : ''

      const res = await axios.get(urlData);
      console.log("res=", res);
      importDashboardFromJSON(res.data).then(() => {
        url.value = ''
      })
    }
    const importFromJsonStr = async () => {
      // get the dashboard
      importDashboardFromJSON(jsonStr.value).then(() => {
        jsonStr.value = ''
      })
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
      jsonFile,
      importFromUrl,
      url,
      jsonStr,
      importFromJsonStr
    }
  }
})
</script>
