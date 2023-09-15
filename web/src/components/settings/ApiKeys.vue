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
  <q-page class="page q-pa-md">
    <div class="row text-h6 q-mb-sm">
      {{ t("settings.rumKeyLabel") }}
    </div>
    <div v-for="key in rumAPIKey" :key="key.id">
      <div class="tabContent q-mb-md q-pa-sm">
        <pre data-test="curl-content-text">
          {{ key.key }}
        </pre>

        <q-btn
          data-test="user-api-key-copy-btn"
          flat
          round
          size="sm"
          class="float-right btn-copy"
          color="grey"
          icon="content_copy"
          @click="copyToClipboardFn(key.key)"
        />
      </div>
    </div>
    <q-separator class="separator q-ma-md" />
    <div class="row text-h6 q-mb-sm">
      {{ t("settings.userKeyLabel") }}

      <q-btn
        class="q-ml-md q-mb-xs text-bold no-border"
        padding="sm lg"
        color="secondary"
        no-caps
        :label="t(`settings.newUserKeyBtnLbl`)"
        @click="generateUserKey('User API Key')"
      />
    </div>

    <div v-for="key in userAPIKey" :key="key.id" v-if="userAPIKey != null">
      <div class="tabContent q-mb-md q-pa-sm">
        <label class="text-bold">{{ key.name }}</label>
        <pre data-test="curl-content-text">
          {{ key.key }}
        </pre>

        <q-btn
          data-test="user-api-key-del-btn"
          flat
          round
          size="sm"
          class="float-right btn-delete"
          :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
          @click="deleteUserKey(key.id)"
        />

        <q-btn
          data-test="user-api-key-copy-btn"
          flat
          round
          size="sm"
          class="float-right btn-copy"
          color="grey"
          icon="content_copy"
          @click="copyToClipboardFn(key.key)"
        />
      </div>
    </div>
    <div v-else>
      <label class="text-bold">User API Key Not Found.</label>
    </div>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import apiKeysService from "@/services/api_keys";
import { getImageURL } from "@/utils/zincutils";
import { copyToClipboard, useQuasar } from "quasar";

export default defineComponent({
  name: "PageIngestion",
  methods: {
    generateUserKey(name: string) {
      apiKeysService
        .createUserAPIKey({ name: name })
        .then((response) => {
          this.listAPIKeys();
          this.q.notify({
            type: "positive",
            message: "User API Key Generated Successfully!",
            timeout: 3000,
          });
        })
        .catch(() => {
          this.q.notify({
            type: "negative",
            message: "Error while generating User API Key.",
            timeout: 3000,
          });
        });
    },
    deleteUserKey(id: string) {
      apiKeysService
        .deleteUserAPIKey(id)
        .then(() => {
          this.listAPIKeys();
          this.q.notify({
            type: "positive",
            message: "User API Key Deleted Successfully!",
            timeout: 3000,
          });
        })
        .catch(() => {
          this.q.notify({
            type: "negative",
            message: "Error while deleting User API Key.",
            timeout: 3000,
          });
        });
    },
  },
  setup() {
    const { t } = useI18n();
    const q = useQuasar();
    const store = useStore();
    const router: any = useRouter();
    const userAPIKey = ref([]);
    const rumAPIKey = ref([]);

    const listAPIKeys = () => {
      apiKeysService.list().then((response) => {
        userAPIKey.value = response.data.data.user_keys;
        rumAPIKey.value = response.data.data.rum_keys;
      });
    };

    onBeforeMount(() => {
      listAPIKeys();
    });

    const copyToClipboardFn = (content: any) => {
      copyToClipboard(content)
        .then(() => {
          q.notify({
            type: "positive",
            message: "Content Copied Successfully!",
            timeout: 5000,
          });
        })
        .catch(() => {
          q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
        });
    };

    return {
      t,
      q,
      store,
      router,
      rumAPIKey,
      userAPIKey,
      getImageURL,
      copyToClipboardFn,
      listAPIKeys,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: rgba(136, 136, 136, 0.103);
  // tab content bg color
  border-radius: 0.5rem;
  &__head {
    .title {
      font-size: 0.75rem;
      line-height: 1rem;
      font-weight: 600;
    }
  }
  pre {
    white-space: initial;
    word-wrap: break-word;
    font-size: 0.75rem;
    margin: 0;
    padding: 10px;
  }

  .btn-copy {
    margin-top: -30px;
  }

  .btn-delete {
    margin-top: -30px;
    margin-right: 30px;
  }
}
</style>
