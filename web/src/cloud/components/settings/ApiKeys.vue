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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-page class="page q-pa-md">
    <div class="row text-h6 q-mb-sm">
      <div class="col">
        {{ t("settings.userKeyLabel") }}
      </div>
      <div class="space"></div>
      <div class="col-auto float-right">
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border float-right"
          padding="sm lg"
          position="right"
          color="secondary"
          no-caps
          :label="t(`settings.newUserKeyBtnLbl`)"
          @click="editUserKey({})"
        />
      </div>
    </div>

    <div v-if="loading" class="text-h6">Loading...</div>
    <div v-else-if="userAPIKey.length > 0">
      <div v-for="key in userAPIKey" :key="key?.id">
        <div class="tabContent q-mb-md q-pa-sm">
          <label class="text-bold">{{ key.api_name }}</label>
          <pre data-test="curl-content-text">
          {{ key.api_key }}<br />
          {{t("user.allowedOrg")}}: {{ key.org_identifier }}
        </pre>

          <q-btn
            data-test="user-api-key-edit-btn"
            flat
            round
            size="sm"
            class="float-right btn-edit"
            icon="edit"
            @click="editUserKey(key)"
          />

          <q-btn
            data-test="user-api-key-del-btn"
            flat
            round
            size="sm"
            class="float-right btn-delete"
            :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
            @click="handleDeleteAction(key.id)"
          />

          <q-btn
            data-test="user-api-key-copy-btn"
            flat
            round
            size="sm"
            class="float-right btn-copy"
            color="grey"
            icon="content_copy"
            @click="copyToClipboardFn(key.api_key)"
          />
        </div>
      </div>

      <!-- Instruction about how to use API key -->
      <div class="text-subtitle1 q-mb-sm">
        <span class="text-h6 text-bold"
          >Incorporating API Keys: A How-To Guide</span
        >
        <q-separator />
        The API key serves as the primary means of user authentication, enabling
        access to a range of APIs. It is essential to include the API key as a
        header in your requests. The designated attribute for transmitting the
        API key is:
        <div class="tabContent q-pb-md q-mt-md q-mb-md">
          openobserve-apikey: [YOUR_API_KEY]
        </div>
        Ensure that you replace [YOUR_API_KEY] with the unique API key assigned
        to you. This integration ensures secure and authorized access to the
        diverse functionalities provided by the APIs.

        <div class="q-my-md">
          <span class="text-h6 text-bold">Example</span>
          <q-separator />
          <span class="text-subtitle text-bold">cURL</span>
          <ContentCopy class="q-mt-sm" :content="curlConfig" />

          <div class="q-mt-md">
            <span class="text-subtitle text-bold">Node JS</span>
            <ContentCopy class="q-mt-sm" :content="nodejsConfig" />
          </div>
          <div class="q-mt-md">
            <span class="text-subtitle text-bold">Java</span>
            <ContentCopy class="q-mt-sm" :content="javaConfig" />
          </div>
        </div>
      </div>
    </div>
    <div v-else>
      <label class="text-bold">{{ t("user.apiKeyNotFound") }}</label>
    </div>

    <q-dialog
      v-model="toggleCreateUserKeyDialog"
      position="right"
      full-height
      maximized
    >
      <add-user-key
        @listUserAPIKeys="
          toggleCreateUserKeyDialog = false;
          listAPIKeys();
        "
        :model-value="editRecordSet"
      ></add-user-key>
    </q-dialog>

    <q-dialog v-model="toggleDeleteUserKeyDialog">
      <q-card style="width: 700px; max-width: 80vw">
        <q-card-section>
          <div class="text-h6">Delete API Key</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          {{ t("user.deleteAPIKeyMessage") }}
        </q-card-section>

        <q-card-actions align="right" class="bg-white text-teal">
          <q-btn
            unelevated
            no-caps
            :label="t('common.ok')"
            color="primary"
            @click="deleteUserKey(deleteID)"
            v-close-popup="true"
          />
          <q-btn unelevated
          no-caps :label="t('common.cancel')"
v-close-popup="true" />
        </q-card-actions>
      </q-card>
    </q-dialog>
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

import AddUserKey from "./AddUserKey.vue";
import ContentCopy from "@/components/CopyContent.vue";

export default defineComponent({
  name: "PageIngestion",
  components: { AddUserKey, ContentCopy },
  methods: {
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
    editUserKey(key: any) {
      this.editRecordSet = key;
      this.toggleCreateUserKeyDialog = true;
    },
    handleDeleteAction(id: string) {
      this.toggleDeleteUserKeyDialog = true;
      this.deleteID = id;
    },
  },
  setup() {
    const { t } = useI18n();
    const q = useQuasar();
    const store = useStore();
    const router: any = useRouter();
    const userAPIKey: any = ref([]);
    const rumAPIKey: any = ref([]);
    const toggleCreateUserKeyDialog: any = ref(false);
    const toggleDeleteUserKeyDialog: any = ref(false);
    const editRecordSet: any = ref();
    const deleteID: any = ref("");
    const loading: any = ref(false);

    const listAPIKeys = () => {
      loading.value = true;
      apiKeysService
        .list()
        .then((response) => {
          loading.value = false;
          userAPIKey.value = response.data.data;
        })
        .catch(() => {
          loading.value = false;
          q.notify({
            type: "negative",
            message: "Error while fetching API Keys.",
            timeout: 3000,
          });
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

    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    const url = new URL(store.state.API_ENDPOINT);

    endpoint.value = {
      url: store.state.API_ENDPOINT,
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol.replace(":", ""),
      tls: url.protocol === "https:" ? "On" : "Off",
    };
    const apiendpoint = endpoint.value.url + "/api/";

    const javaConfig = `import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class ApiExample {
    public static void main(String[] args) throws Exception {
        String apiKey = 'YOUR_API_KEY';
        String apiUrl = '${apiendpoint}';

        URL url = new URL(apiUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();

        connection.setRequestMethod('GET');
        connection.setRequestProperty('openobserve-apikey', apiKey);

        BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream()));
        String inputLine;
        StringBuilder content = new StringBuilder();

        while ((inputLine = in.readLine()) != null) {
            content.append(inputLine);
        }

        in.close();
        connection.disconnect();

        System.out.println(content.toString());
    }
}`;

    const nodejsConfig = `const fetch = require('node-fetch');

const apiKey = 'YOUR_API_KEY';
const apiUrl = '${apiendpoint}';

fetch(apiUrl, {
  method: 'GET',
  headers: {
    'openobserve-apikey': apiKey,
  },
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
`;

    const curlConfig = `curl -H "openobserve-apikey: YOUR_API_KEY" ${apiendpoint}`;

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
      editRecordSet,
      deleteID,
      toggleCreateUserKeyDialog,
      toggleDeleteUserKeyDialog,
      apiendpoint,
      javaConfig,
      nodejsConfig,
      curlConfig,
      loading,
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
  .btn-edit {
    margin-top: -30px;
    margin-right: 60px;
  }
}
</style>
