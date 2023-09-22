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

    <div v-for="key in userAPIKey" :key="key.id" v-if="userAPIKey.length > 0">
      <div class="tabContent q-mb-md q-pa-sm">
        <label class="text-bold">{{ key.api_name }}</label>
        <pre data-test="curl-content-text">
          {{ key.api_key }}<br />
          Allowed Organization: {{ key.org_identifier }}
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
    <div v-else>
      <label class="text-bold">User API Key Not Found.</label>
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
          <div class="text-h6">Medium</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          Are you sure you want to delete this User API Key? This action cannot
          be undone. Click OK to confirm.
        </q-card-section>

        <q-card-actions align="right" class="bg-white text-teal">
          <q-btn
            flat
            label="OK"
            @click="deleteUserKey(deleteID)"
            v-close-popup
          />
          <q-btn flat label="CANCLE" v-close-popup />
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

export default defineComponent({
  name: "PageIngestion",
  components: { AddUserKey },
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
    const userAPIKey = ref([]);
    const rumAPIKey = ref([]);
    const toggleCreateUserKeyDialog = ref(false);
    const toggleDeleteUserKeyDialog = ref(false);
    const editRecordSet = ref();
    const deleteID = ref("");

    const listAPIKeys = () => {
      apiKeysService
        .list()
        .then((response) => {
          userAPIKey.value = response.data.data;
        })
        .catch(() => {
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
