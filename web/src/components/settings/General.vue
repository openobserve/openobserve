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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <!-- <q-page class="page q-pa-md"> General Settings </q-page> -->
  <q-card class="column full-height">
    <div class="q-px-md q-py-md">
      <div class="text-body1 text-bold">
          Organization Settings
    </div>
  </div>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
      <q-form ref="addFolderForm" @submit.stop="onSubmit.execute">
        <q-input
          v-model="scrapeIntereval"
          label="Scrape Interval *"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val) => !!(val.trim()) || 'Scrape Interval is required']"
          :lazy-rules="true"
        />
        <span>&nbsp;</span>

        <div class="flex justify-center q-mt-lg">
          <q-btn
            data-test="dashboard-add-submit"
            :disable="scrapeIntereval.trim() === ''"
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
// @ts-ignore
import { defineComponent, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "PageGeneralSettings",
  setup() {
    const { t } = useI18n();
    const q = useQuasar();
    const store = useStore();
    const router: any = useRouter();
    const scrapeIntereval = ref(store.state.organizationData.scrapeInterval);

    const onSubmit = useLoading(async () => {
      await store.dispatch("updateOrganization", {
        ...store.state.organizationData,
        scrapeInterval: scrapeIntereval.value,
      });
    });

    return {
      t,
      q,
      store,
      router,
      scrapeIntereval,
      onSubmit
    };
  },
});
</script>
