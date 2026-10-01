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
  <div class="scroll h-full w-full overflow-auto" data-test="html-renderer-scroll-container">
    <div
      ref="contentRef"
      class="min-h-full shrink-0"
      :id="scopeId"
      :class="['prose prose-sm max-w-none px-2 py-1', isDark && 'prose-invert']"
      data-test="html-renderer"
    ></div>
    <Teleport v-for="embed in refusedEmbeds" :key="embed.key" :to="embed.slot">
      <OBanner
        variant="info"
        dense
        icon="block"
        :content="t('dashboard.htmlPanelEmbedBlocked')"
        data-test="html-renderer-blocked-embed"
      />
    </Teleport>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted, ref, shallowRef, watch } from "vue";
import { useTheme } from "@/composables/useTheme";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { processVariableContent } from "@/utils/dashboard/variables/variablesUtils";
import { sanitizeHtmlPanel } from "@/utils/dashboard/htmlPanelSanitizer";

// fallback scope suffix for panels rendered without a panelId
let htmlPanelSeq = 0;
let refusedEmbedSeq = 0;

export default defineComponent({
  name: "HTMLRenderer",
  components: { OBanner },
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
    const { isDark } = useTheme();
    const { t } = useI18nTyped();
    const contentRef = ref<HTMLElement | null>(null);
    const refusedEmbeds = shallowRef<{ key: number; slot: HTMLElement }[]>([]);

    const instanceSeq = ++htmlPanelSeq;
    const scopeId = computed(() => {
      const raw = props.panelId ? String(props.panelId) : `i${instanceSeq}`;
      return `o2-html-panel-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    });

    const processedContent = computed(() => {
      const context = {
        tabId: props.tabId,
        panelId: props.panelId,
      };
      return processVariableContent(props.htmlContent, props.variablesData, context);
    });

    // re-serializing through v-html would let CSSOM-decoded text re-parse as markup
    const renderContent = () => {
      const slots: { key: number; slot: HTMLElement }[] = [];
      contentRef.value?.replaceChildren(
        sanitizeHtmlPanel(processedContent.value ?? "", `#${scopeId.value}`, (slot) =>
          slots.push({ key: ++refusedEmbedSeq, slot }),
        ),
      );
      refusedEmbeds.value = slots;
    };

    onMounted(renderContent);
    watch([processedContent, scopeId], renderContent, { flush: "post" });

    return {
      t,
      contentRef,
      refusedEmbeds,
      isDark,
      scopeId,
      processedContent,
    };
  },
});
</script>
