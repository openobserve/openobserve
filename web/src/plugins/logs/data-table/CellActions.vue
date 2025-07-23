<template>
  <div
    class="field_overlay tw-absolute tw-right-0 tw-top-[50%] table-cell-actions tw-translate-y-[-50%]"
    :class="backgroundClass"
    :title="row[column.id]"
    :data-test="`log-add-data-from-column-${row[column.id]}`"
  >
    <q-btn
      class="q-mr-xs"
      size="6px"
      @click.prevent.stop="copyLogToClipboard(row[column.id])"
      title="Copy"
      round
      icon="content_copy"
    />
    <q-btn
      class="q-mr-xs"
      size="6px"
      @click.prevent.stop="addSearchTerm(column.id, row[column.id], 'include')"
      :data-test="`log-details-include-field-${row[column.id]}`"
      title="Include Term"
      round
    >
      <q-icon color="currentColor">
        <EqualIcon></EqualIcon>
      </q-icon>
    </q-btn>
    <q-btn
      size="6px"
      @click.prevent.stop="addSearchTerm(column.id, row[column.id], 'exclude')"
      title="Exclude Term"
      :data-test="`log-details-exclude-field-${row[column.id]}`"
      round
    >
      <q-icon color="currentColor">
        <NotEqualIcon></NotEqualIcon>
      </q-icon>
    </q-btn>
    <q-btn
      v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
      class="q-ml-xs"
      :ripple="false"
      @click.prevent.stop="sendToAiChat(JSON.stringify(row[column.id]))"
      data-test="menu-link-ai-item"
      no-caps
      :borderless="true"
      flat
      size="6px"
      dense
      style="border-radius: 100%; border: 1px solid #fff;"
    >
      <div class="row items-center no-wrap">
        <img height="14px" width="14px" :src="getBtnLogo" class="header-icon ai-icon" />
      </div>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits, computed } from "vue";
import { useStore } from "vuex";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";

defineProps({
  column: {
    type: Object,
    required: true,
  },
  row: {
    type: Object,
    required: true,
  },
});

const store = useStore();

const emit = defineEmits(["copy", "addSearchTerm", "addFieldToTable", "sendToAiChat"]);

const copyLogToClipboard = (value: any) => {
  emit("copy", value, false);
};
const addSearchTerm = (
  field: string,
  field_value: string | number | boolean,
  action: string,
) => {
  emit("addSearchTerm", field, field_value, action);
};

const backgroundClass = computed(() =>
  store.state.theme === "dark" ? "tw-bg-black" : "tw-bg-white",
);
const sendToAiChat = (value: any) => {
  emit("sendToAiChat", value);
};
const getBtnLogo = computed(() => {
      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg')
    })
</script>
