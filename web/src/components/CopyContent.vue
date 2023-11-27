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
  <div class="tabContent">
    <div class="tabContent__head">
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
    <pre data-test="rum-content-text">{{ displayContent || content }}</pre>
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
