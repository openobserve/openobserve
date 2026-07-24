<template>
  <!-- ai button is only enabled when it is enteprise version and also ai is enabled from the BE -->
  <OButton
    v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
    variant="ghost"
    :size="size"
    @click.stop="sendToAiChat"
    data-test="o2-ai-context-add-btn"
    class="group [background:var(--color-gradient-ai-subtle)]! [transition:background_0.3s_ease,box-shadow_0.3s_ease] hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)] hover:[background:var(--color-gradient-ai)]! dark:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] dark:hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)]!"
    :class="props.class"
    :style="props.style"
  >
    <div class="flex flex-nowrap items-center">
      <img
        :height="props.imageHeight"
        :width="props.imageWidth"
        :src="getBtnLogo"
        class="header-icon ai-icon [transition:transform_0.6s_ease] group-hover:rotate-180 group-hover:brightness-0 group-hover:invert"
      />
    </div>
  </OButton>
</template>

<style scoped>
/* keep(lib-override:o2-button): `.ai-btn` is this component's row-button modifier,
   an absolute-positioning variant a caller can opt into via `props.class`. Every
   element it styles (the OButton root and the <img class="ai-icon"> above) is
   rendered HERE, so this is the owning scope. (The logs/traces tables migrated to
   OTable now position the button via OTable's `#cell-hover-actions` overlay, so
   they no longer pass `.ai-btn`; it is retained for any other caller.)
   Why the !important: OButton's own base `relative` outranks the positioning
   passed via props. `translate` (not `transform`) is the property to override —
   Tailwind v4 emits -translate-y-1/2 through the CSS `translate` shorthand. */
.ai-btn {
  position: absolute !important;
  top: 50% !important;
  right: 0.875rem !important;
  translate: -50% -50% !important;
  height: 0.875rem !important;
  min-height: 0 !important;
  width: 0.9rem !important;
  min-width: 0 !important;
  border-radius: 0.25rem !important;
}

.ai-btn img.ai-icon {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

/* Suppress the hover box-shadow — it visually bleeds outside the row boundary */
.ai-btn:hover {
  box-shadow: none !important;
}
</style>

<script setup lang="ts">
import { getImageURL } from "@/utils/zincutils";
import { computed, type PropType } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import useTheme from "@/composables/useTheme";
//we can pass class to the button to make it customized
//all of the props are optional
const props = defineProps({
  class: {
    type: String,
    default: "",
    required: false,
  },
  // OButton size token (e.g. "icon-toolbar", "icon-xs-circle"). Defaults to
  // the toolbar size the button previously hard-coded, so existing callers are
  // unchanged; table cell overlays pass a smaller token to match sibling
  // actions (QA #2239: AI button oversized vs other action buttons).
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
  //this is for image height and width sometimes we need to change the size of the image
  imageHeight: {
    type: String,
    default: "20px",
    required: false,
  },
  imageWidth: {
    type: String,
    default: "20px",
    required: false,
  },
});
//once user clicks on the button, it will emit the event to the parent component
const emit = defineEmits(["sendToAiChat"]);
const store = useStore();
const { isDark } = useTheme();
const getBtnLogo = computed(() => {
  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});
//this function is responsible for sending the event / button is clicked to the parent component
const sendToAiChat = () => {
  emit("sendToAiChat");
};
</script>
