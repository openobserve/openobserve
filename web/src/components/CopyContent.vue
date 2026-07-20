<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="relative rounded-lg overflow-hidden copy-content-block" :class="store.state.theme === 'dark' ? 'bg-[rgba(255,255,255,0.06)]' : 'bg-[rgba(0,0,0,0.05)]'">
    <div class="absolute top-2 right-2 z-10">
      <OButton
        data-test="rum-copy-btn"
        variant="ghost"
        size="icon-xs-sq"
        @click="copyToClipboardFn()"
      >
        <OIcon name="content-copy" size="sm" />
        <OTooltip content="Copy" side="top" />
      </OButton>
    </div>
    <pre data-test="rum-content-text" class="text-sm whitespace-pre-wrap wrap-break-word m-0 p-3 pr-10 leading-5">{{ computedContent }}</pre>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import { maskText, b64EncodeStandard } from "../utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default defineComponent({
  name: "CopyContent",
  components: { OButton,
    OIcon,
    OTooltip,
},
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
    const store = useStore();
    const { t } = useI18n();
    const email = ref(store.state.userInfo.email);
    const passcode = ref(store.state.organizationData.organizationPasscode);
    const basicPasscode = ref();

    const replaceValues = (data: string, isMask: boolean = false) => {
      email.value = store.state.userInfo.email;
      passcode.value = store.state.organizationData.organizationPasscode;
      basicPasscode.value = b64EncodeStandard(
        `${email.value}:${store.state.organizationData.organizationPasscode}`
      );
      if (isMask) {
        return data
          .replaceAll("[EMAIL]", maskText(email.value))
          .replaceAll("[PASSCODE]", maskText(passcode.value))
          .replaceAll("[BASIC_PASSCODE]", maskText(basicPasscode.value));
      } else {
        return data
          .replaceAll("[EMAIL]", email.value)
          .replaceAll("[PASSCODE]", passcode.value)
          .replaceAll("[BASIC_PASSCODE]", basicPasscode.value);
      }
    };

    const copyToClipboardFn = () => {
      const content = replaceValues(props.content, false);
      copyToClipboard(content, {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    };

    const displayData = ref(props.displayContent || props.content);
    const computedContent = ref();
    computedContent.value = replaceValues(displayData.value, true);

    const refreshData = () => {
      computedContent.value = replaceValues(displayData.value, true);
    };

    return {
      t,
      store,
      copyToClipboardFn,
      displayData,
      replaceValues,
      computedContent,
      refreshData,
    };
  },
  computed: {
    computedData() {
      return this.store.state.organizationData.organizationPasscode;
    },
  },
  watch: {
    content(newVal: string) {
      this.displayData = newVal;
      this.refreshData();
    },
    computedData() {
      this.refreshData();
    },
  },
});
</script>
