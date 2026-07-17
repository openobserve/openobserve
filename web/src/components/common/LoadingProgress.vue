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
          class="absolute inset-0 bg-gradient-to-r from-transparent to-transparent via-white/40 dark:via-gray-300/40"
          :style="{
            animation: 'loading-progress-shimmer 1.5s infinite linear',
            width: '200%',
            left: '-200%',
          }"
        ></div>
      </div>
      <!-- Moving circle indicator -->
      <div
        class="absolute top-0 w-[3px] h-0.5 rounded-full shadow-[0_0_10px_2px_rgba(89,96,178,0.5)] transform translate-x-[-50%]"
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
          class="absolute inset-0 rounded-full bg-white/20 dark:bg-gray-300/20 [animation:loading-progress-pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite]"
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
      const wasLoading = lastLoadingState.value;
      lastLoadingState.value = props.loading;
      return props.loading || wasLoading || isFadingOut.value;
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

