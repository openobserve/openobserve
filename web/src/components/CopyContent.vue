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
  <div class="tabContent">
    <div class="tabContent__head">
      <pre data-test="rum-content-text">{{ displayContent || content }}</pre>
      <div>
        <div class="copy_action">
          <q-btn
            data-test="rum-copy-btn"
            flat
            round
            size="0.5rem"
            padding="0.6rem"
            icon="content_copy"
            color="grey"
            @click="copyToClipboardFn(content)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar, copyToClipboard } from "quasar";

export default defineComponent({
  name: "CopyContent",
  props: {
    content: {
      type: String,
      default: "", // Default value for content prop (empty string in this case)
    },
    displayContent: {
      type: String,
      default: "", // Default value for displayContent prop (empty string in this case)
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const q = useQuasar();

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
      copyToClipboardFn,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: rgba(136, 136, 136, 0.103);
  // tab content bg color
  padding: 10px 20px;
  border-radius: 0.5rem;
  &__head {
    justify-content: space-between;
    display: flex;
  }
  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 14px;
    margin: 0;
    line-height: 30px;
  }
}
</style>
