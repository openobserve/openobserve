<template>
  <!-- ai button is only enabled when it is enteprise version and also ai is enabled from the BE -->
  <OButton
    v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
    variant="ghost"
    size="icon-toolbar"
    @click.stop="sendToAiChat"
    data-test="o2-ai-context-add-btn"
    :aria-label="t('menu.aiAssistant')"
    :class="props.class"
    :style="props.style"
  >
    <AssistantSpark :size="sparkSize" />
  </OButton>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { computed, type PropType } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import AssistantSpark, {
  type AssistantSparkSize,
} from "@/components/ai-assistant/common/AssistantSpark.vue";
import OButton from "@/lib/core/Button/OButton.vue";
const { t } = useI18nTyped();
//we can pass class to the button to make it customized
//all of the props are optional
const props = defineProps({
  class: {
    type: String,
    default: "",
    required: false,
  },
  // Accepted for backward compatibility but deliberately not applied: the button
  // always renders at the "icon-toolbar" size so every AI icon looks identical.
  size: {
    type: String,
    default: "icon-toolbar",
    required: false,
  },
  // String or object: Vue compiles static style="" attributes into objects.
  style: {
    type: [String, Object] as PropType<string | Record<string, string>>,
    default: "",
    required: false,
  },
  // Pixel sizes; the spark snaps to the nearest of 16, 20 or 24.
  imageHeight: {
    type: String,
    default: "20",
    required: false,
  },
  imageWidth: {
    type: String,
    default: "20",
    required: false,
  },
});
//once user clicks on the button, it will emit the event to the parent component
const emit = defineEmits(["sendToAiChat"]);
const store = useStore();
const sparkSize = computed<AssistantSparkSize>(() => {
  const px = Number.parseInt(props.imageWidth, 10) || 20;
  if (px <= 16) return 16;
  return px >= 24 ? 24 : 20;
});
//this function is responsible for sending the event / button is clicked to the parent component
const sendToAiChat = () => {
  emit("sendToAiChat");
};
</script>
