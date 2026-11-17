<script setup lang="ts">
import type { InnerLoadingProps } from "./OInnerLoading.types";
import { onBeforeUnmount, ref, watch } from "vue";
import OSpinner from "../Spinner/OSpinner.vue";
import { useI18nTyped } from "@/types/i18n";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";

const props = withDefaults(defineProps<InnerLoadingProps>(), {
  size: "xs",
  scrim: true,
});

const { t } = useI18nTyped();

// Until it shows, the overlay lets clicks through, so a fast load neither flashes nor swallows one.
const revealed = ref(false);
let revealTimer: ReturnType<typeof setTimeout> | null = null;
function clearRevealTimer(): void {
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = null;
}
watch(
  () => props.showing,
  (showing) => {
    clearRevealTimer();
    revealed.value = false;
    if (showing) revealTimer = setTimeout(() => (revealed.value = true), LOADER_DELAY_MS);
  },
  { immediate: true },
);
onBeforeUnmount(clearRevealTimer);
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="showing"
      class="absolute inset-0 z-10"
      :class="revealed ? '' : 'pointer-events-none'"
      role="status"
      aria-live="polite"
      :aria-label="label ?? t('common.loadingLabel')"
    >
      <!-- The delay's opacity-0 lives below the Transition element, which strips its own opacity-0 after the enter frames. -->
      <div
        class="flex size-full flex-col items-center justify-center gap-2 transition-opacity duration-(--duration-overlay-in)"
        :class="[scrim ? 'bg-inner-loading-overlay' : '', revealed ? '' : 'opacity-0']"
      >
        <OSpinner variant="ring" :size="size" instant />
        <span v-if="label" class="text-inner-loading-label text-xs select-none">
          {{ label }}
        </span>
      </div>
    </div>
  </Transition>
</template>
