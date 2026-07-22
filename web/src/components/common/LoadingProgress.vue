<template>
  <div
    class="absolute top-0 left-0 w-full z-[999] transition-opacity duration-500 ease-out"
    :class="{
      'opacity-0': !loading && !isFadingOut,
      'opacity-100': loading || isFadingOut,
    }"
  >
    <div
      class="w-full h-0.5 relative overflow-x-hidden bg-progress-bar-track"
    >
      <div
        class="h-full relative overflow-hidden"
        :class="
          'bg-brand-indigo'
        "
        :style="{
          width: `${displayPercentage}%`,
          transition: shouldAnimate
            ? 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
          willChange: loading ? 'width' : 'auto',
          transform: 'translateZ(0)', // Force GPU acceleration
        }"
      >
        <div
          class="loading-progress__shimmer absolute inset-0 bg-gradient-to-r from-transparent to-transparent via-white/40 dark:via-grey-300/40"
        ></div>
      </div>
      <!-- Moving circle indicator -->
      <div
        class="absolute top-0 w-0.75 h-0.5 rounded-full shadow-[0_0_0.625rem_0.125rem_color-mix(in_srgb,var(--color-brand-indigo)_50%,transparent)] transform -translate-x-1/2"
        :class="
          'bg-brand-indigo'
        "
        :style="{
          left: `${displayPercentage}%`,
          transition: shouldAnimate
            ? 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
        }"
      >
        <div
          class="loading-progress__head-glow absolute inset-0 rounded-full bg-white/20 dark:bg-grey-300/20"
        ></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onUnmounted } from "vue";

export default defineComponent({
  name: "LoadingProgress",
  props: {
    loading: {
      type: Boolean,
      required: true,
    },
    loadingProgressPercentage: {
      type: Number,
      required: true,
      validator: (value: number) => {
        return value >= 0 && value <= 100;
      },
    },
  },

  setup(props) {
    const lastLoadingState = ref(props.loading);
    const internalPercentage = ref(props.loadingProgressPercentage);
    const isFadingOut = ref(false);
    let fadeOutTimeout: number;

    watch(
      () => props.loading,
      (newValue, oldValue) => {
        // Remember the previous loading state so shouldAnimate can stay
        // true through the loading -> not-loading transition.
        lastLoadingState.value = oldValue;

        if (oldValue && !newValue) {
          // When loading becomes false, quickly complete to 100% and start fade out
          internalPercentage.value = 100;
          isFadingOut.value = true;

          clearTimeout(fadeOutTimeout);
          fadeOutTimeout = window.setTimeout(() => {
            isFadingOut.value = false;
            internalPercentage.value = 0;
          }, 500); // Match the fade-out duration
        }
      },
    );

    onUnmounted(() => {
      clearTimeout(fadeOutTimeout);
    });

    const shouldAnimate = computed(() => {
      return props.loading || lastLoadingState.value || isFadingOut.value;
    });

    const displayPercentage = computed(() => {
      if (isFadingOut.value) {
        return 100; // Keep at 100% while fading out
      }
      if (!props.loading) {
        return internalPercentage.value;
      }
      if (props.loadingProgressPercentage < 5) {
        return 5;
      }
      return props.loadingProgressPercentage;
    });

    return {
      displayPercentage,
      shouldAnimate,
      isFadingOut,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): the gloss sweep and the head glow belong to this progress bar
   alone. Both `animation`s are declared here rather than on the elements (one was
   a template `[animation:…]` utility, one an inline `:style` binding) — Vue's
   scoped compiler rewrites `animation` only inside this block, so keeping the
   keyframe and its reference together here is what makes the rename resolve.
   The scoped `[data-v-*]` attribute also lifts these rules above the `inset-0`
   utility, so the shimmer's own `left` wins regardless of stylesheet order. */
.loading-progress__shimmer {
  width: 200%;
  left: -200%;
  animation: shimmer 1.5s infinite linear;
}

.loading-progress__head-glow {
  animation: head-glow-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes shimmer {
  0% {
    transform: translateX(-200%);
  }
  100% {
    transform: translateX(200%);
  }
}

@keyframes head-glow-pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 0.4;
  }
}
</style>

