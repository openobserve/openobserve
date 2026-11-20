<template>
  <!-- ai button is only enabled when it is enteprise version and also ai is enabled from the BE -->
  <OButton
    v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
    variant="outline"
    size="icon-toolbar"
    @click.stop="sendToAiChat"
    data-test="o2-ai-context-add-btn"
    :aria-label="t('menu.aiAssistant')"
    :class="props.class"
    :style="props.style"
  >
    <OIcon name="auto-awesome" size="sm" class="text-ai-accent" />
  </OButton>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { type PropType } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  // Accepted for backward compatibility; declared so callers' values do not fall through to the button.
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
//this function is responsible for sending the event / button is clicked to the parent component
const sendToAiChat = () => {
  emit("sendToAiChat");
};
</script>
