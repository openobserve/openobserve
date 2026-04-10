<template>
  <div class="tw:relative">
    <q-btn
      v-if="showCopyButton"
      dense
      size="sm"
      no-caps
      class="tw:absolute! tw:top-0! tw:right-0 tw:z-10 q-px-sm tw:py-[0.35rem]! tw:bg-[var(--o2-tag-grey-2)]!"
      :class="copyButtonClass"
      icon="content_copy"
      @click="copyToClipboard"
    >
      <q-tooltip>{{ t("common.copyToClipboard") }}</q-tooltip>
    </q-btn>
    <div class="q-pb-xs flex justify-start items-center q-px-md copy-log-btn">
      <!-- Toolbar slot: consumers add context-specific buttons (View Trace, View Related, etc.) -->
      <slot name="toolbar" />
    </div>
    {
    <div
      class="log_json_content"
      v-for="(key, index) in Object.keys(value)"
      :key="key"
    >
      <!-- Field dropdown slot: render the button only when the slot is provided -->
      <q-btn-dropdown
        v-if="hasFieldDropdownSlot"
        data-test="json-preview-field-dropdown-btn"
        size="0.5rem"
        flat
        outlined
        filled
        dense
        class="q-ml-sm pointer tw:px-0!"
        :name="'img:' + getImageURL('images/common/add_icon.svg')"
        aria-label="Add icon"
      >
        <q-list class="logs-table-list">
          <slot name="field-dropdown" :field="key" :value="value[key]" />
        </q-list>
      </q-btn-dropdown>

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
import { computed, useSlots } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { copyToClipboard as quasarCopyToClipboard, useQuasar } from "quasar";
import { getImageURL } from "@/utils/zincutils";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import ChunkedContent from "@/components/logs/ChunkedContent.vue";

export default {
  name: "JsonPreview",
  components: {
    LogsHighLighting,
    ChunkedContent,
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
    };
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/logs/json-preview.scss";
</style>
