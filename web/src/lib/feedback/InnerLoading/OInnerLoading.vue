<script setup lang="ts">
import type { InnerLoadingProps } from "./OInnerLoading.types";
import OSpinner from "../Spinner/OSpinner.vue";
import { useI18n } from "vue-i18n";

withDefaults(defineProps<InnerLoadingProps>(), {
  size: "xs",
  scrim: true,
});

const { t } = useI18n();
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
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
      :class="scrim ? 'bg-inner-loading-overlay' : ''"
      role="status"
      aria-live="polite"
      :aria-label="label ?? t('common.loadingLabel')"
    >
      <OSpinner variant="ring" :size="size" />
      <span v-if="label" class="text-inner-loading-label text-xs select-none">
        {{ label }}
      </span>
    </div>
  </Transition>
</template>
