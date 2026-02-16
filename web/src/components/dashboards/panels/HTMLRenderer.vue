<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="scroll" style="width: 100%; height: 100%; overflow: auto">
    <div
      :class="[
        'tw:prose tw:prose-sm tw:max-w-none',
        store.state?.theme === 'dark' && 'tw:prose-invert',
      ]"
      v-html="sanitizedContent"
      data-test="html-renderer"
    ></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";
import { processVariableContent } from "@/utils/dashboard/variables/variablesUtils";
import DOMPurify from "dompurify";

export default defineComponent({
  name: "HTMLRenderer",
  props: {
    htmlContent: {
      type: String,
      default: "",
    },
    variablesData: {
      type: Object,
      default: () => ({}),
    },
    tabId: {
      type: String,
      default: undefined,
    },
    panelId: {
      type: String,
      default: undefined,
    },
  },
  setup(props): any {
    const store = useStore();

    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.nodeName === "IFRAME") {
        // Remove srcdoc to prevent inline HTML/script injection
        node.removeAttribute("srcdoc");

        // Only allow https:// sources to block javascript: and data: URIs
        const src = node.getAttribute("src") || "";
        if (src && !src.startsWith("https://")) {
          node.removeAttribute("src");
        }

        // Cross-origin iframes (enforced by https-only src above) are already
        // isolated by the browser's same-origin policy — they cannot access
        // the parent page's cookies, DOM, or storage. A forced sandbox attribute
        // breaks video players (YouTube Error 153, Dailymotion localStorage errors)
        // without adding meaningful security for cross-origin content.
      }
    });

    const processedContent = computed(() => {
      const context = {
        tabId: props.tabId,
        panelId: props.panelId,
      };
      return processVariableContent(props.htmlContent, props.variablesData, context);
    });

    const sanitizedContent = computed(() =>
      DOMPurify.sanitize(processedContent.value, {
        ADD_TAGS: ["iframe"],
        ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading"],
      })
    );

    return {
      DOMPurify,
      store,
      processedContent,
      sanitizedContent,
    };
  },
});
</script>
