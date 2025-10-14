<template>
  <div
    class="q-pr-xs q-ml-xs tw-flex tw-items-center tw-justify-center tw-border tw-border-zinc-300 tw-rounded-[0.31rem]"
  >
    <q-toggle
      :model-value="modelValue"
      @update:model-value="$emit('update:modelValue', $event)"
      :data-test="dataTest"
      :disable="disable"
      :size="size"
      :flat="flat"
      :class="[toggleClass, theme === 'dark' ? darkClass : lightClass]"
    />
    <img
      v-if="img"
      :src="getIcon"
      alt="Metrics"
      class="tw-w-[1rem] tw-h-auto"
    />
    <q-tooltip>
      {{ title }}
    </q-tooltip>
  </div>
</template>

<script setup lang="ts">
import { getImageURL } from "@/utils/zincutils";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

interface Props {
  modelValue: boolean;
  dataTest?: string;
  disable?: boolean;
  size?: string;
  flat?: boolean;
  toggleClass?: string;
  darkClass?: string;
  lightClass?: string;
  title?: string;
  img?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: "xs",
  flat: true,
  toggleClass: "o2-toggle-button-xs",
  darkClass: "o2-toggle-button-xs-dark",
  lightClass: "o2-toggle-button-xs-light",
  disable: false,
  img: "",
  title: "",
});

defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const store = useStore();
const theme = computed(() => store.state.theme);
const { t } = useI18n();

const getIcon = computed(() => getImageURL(props.img));
</script>
