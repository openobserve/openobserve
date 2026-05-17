<template>
  <div class="tw:relative">
    <OButton
      v-if="showCopyButton"
      variant="secondary"
      size="icon-sm"
      class="tw:absolute! tw:top-0! tw:right-0 tw:z-10"
      :class="copyButtonClass"
      @click="copyToClipboard"
    >
      <OIcon name="content-copy" size="sm" />
      <q-tooltip>{{ t("common.copyToClipboard") }}</q-tooltip>
    </OButton>
    <div class="q-pb-xs flex justify-start items-center q-px-md copy-log-btn">
      <!-- Toolbar slot: consumers add context-specific buttons (View Trace, View Related, etc.) -->
      <slot name="toolbar" />
    </div>
    {
    <div
      class="log_json_content tw:flex"
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
            class="q-ml-sm log-json-field-dropdown-btn"
            aria-label="Add icon"
          >
            <OIcon :name="dropdownOpenMap[key] ? 'arrow-drop-up' : 'arrow-drop-down'" size="14px" />
          </OButton>
        </template>
        <div class="logs-table-list tw:min-w-[180px]">
          <slot name="field-dropdown"
:field="key"
:value="value[key]" />
        </div>
      </ODropdown>

      <span
        class="tw:pl-[0.625rem]"
        :data-test="`json-preview-key-${key}`"
        :class="store.state.theme === 'dark' ? 'dark' : ''"
      >
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
import { copyToClipboard as quasarCopyToClipboard, useQuasar } from "quasar";
import { getImageURL } from "@/utils/zincutils";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import ChunkedContent from "@/components/logs/ChunkedContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default {
  name: "JsonPreview",
  components: {
    LogsHighLighting,
    ChunkedContent,
    OButton,
    ODropdown,
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
    const $q = useQuasar();
    const slots = useSlots();

    const hasFieldDropdownSlot = computed(() => !!slots["field-dropdown"]);
    const dropdownOpenMap = reactive<Record<string, boolean>>({});

    const copyToClipboard = () => {
      quasarCopyToClipboard(JSON.stringify(props.value, null, 2));
      $q.notify({
        type: "positive",
        message: t("common.copyToClipboard") + "!",
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

<style lang="scss" scoped>
@import "@/styles/logs/json-preview.scss";
</style>
