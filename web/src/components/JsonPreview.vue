<template>
  <div class="relative">
    <OButton
      v-if="showCopyButton"
      variant="secondary"
      size="icon-sm"
      class="absolute! top-0! right-0 z-10"
      :class="copyButtonClass"
      @click="copyToClipboard"
    >
      <OIcon name="content-copy" size="sm" />
      <OTooltip :content="t('common.copyToClipboard')" />
    </OButton>
    <div class="copy-log-btn flex items-center justify-start px-3 pb-1">
      <!-- Toolbar slot: consumers add context-specific buttons (View Trace, View Related, etc.) -->
      <slot name="toolbar" />
    </div>
    {
    <div
      class="flex font-mono text-xs whitespace-pre-wrap"
      v-for="(key, index) in Object.keys(value)"
      :key="key"
    >
      <!-- Field dropdown slot: render the button only when the slot is provided -->
      <ODropdown
        v-if="hasFieldDropdownSlot"
        v-model:open="dropdownOpenMap[key]"
        side="bottom"
        align="start"
      >
        <template #trigger>
          <OButton
            data-test="json-preview-field-dropdown-btn"
            size="xs"
            variant="ghost"
            class="ml-2 h-5! min-h-5! w-5! min-w-5! p-0! align-middle"
            :aria-label="t('common.addIcon')"
          >
            <OIcon :name="dropdownOpenMap[key] ? 'arrow-drop-up' : 'arrow-drop-down'" size="sm" />
          </OButton>
        </template>
        <div class="logs-table-list min-w-45">
          <slot name="field-dropdown" :field="key" :value="value[key]" />
        </div>
      </ODropdown>

      <span class="pl-2.5" :data-test="`json-preview-key-${key}`">
        <span class="log-key">{{ key }}</span
        ><span class="log-separator">: </span
        ><span
          ><ChunkedContent
            v-if="getContentSize(value[key]) > 50000"
            :data="value[key]"
            :field-key="`json_preview_${key}`"
            :query-string="highlightQuery"
            :simple-mode="false" /><LogsHighLighting
            v-else
            :data="value[key]"
            :show-braces="false"
            :query-string="highlightQuery" /></span
        ><span v-if="index < Object.keys(value).length - 1">,</span>
      </span>
    </div>
    }
  </div>
</template>

<script lang="ts">
import { computed, reactive, useSlots } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { copyToClipboard as copyTextToClipboard } from "@/utils/clipboard";
import { getImageURL } from "@/utils/zincutils";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import ChunkedContent from "@/components/logs/ChunkedContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
export default {
  name: "JsonPreview",
  components: {
    LogsHighLighting,
    ChunkedContent,
    OButton,
    ODropdown,
    OTooltip,
    OIcon,
  },
  props: {
    value: {
      type: Object,
      required: true,
      default: () => ({}),
    },
    showCopyButton: {
      type: Boolean,
      default: true,
    },
    highlightQuery: {
      type: String,
      default: "",
    },
    copyButtonClass: {
      type: String,
      default: "",
    },
  },
  emits: ["copy"],
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const store = useStore();
    const slots = useSlots();

    const hasFieldDropdownSlot = computed(() => !!slots["field-dropdown"]);
    const dropdownOpenMap = reactive<Record<string, boolean>>({});

    const copyToClipboard = () => {
      copyTextToClipboard(JSON.stringify(props.value, null, 2), {
        successMessage: t("common.copyToClipboard") + "!",
        timeout: 1500,
      });
      emit("copy", props.value);
    };

    const getContentSize = (data: any): number => {
      if (data === null || data === undefined) return 0;
      if (typeof data === "string") return data.length;
      if (typeof data === "object") {
        try {
          return JSON.stringify(data).length;
        } catch {
          return 0;
        }
      }
      return String(data).length;
    };

    return {
      t,
      store,
      hasFieldDropdownSlot,
      copyToClipboard,
      getContentSize,
      getImageURL,
      dropdownOpenMap,
    };
  },
};
</script>
