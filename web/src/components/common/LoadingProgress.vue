<template>
  <div
    class="tw-absolute tw-top-0 tw-left-0 tw-w-full tw-z-[999] tw-transition-opacity tw-duration-500 tw-ease-out"
    :class="{
      'tw-opacity-0': !loading && !isFadingOut,
      'tw-opacity-100': loading || isFadingOut,
    }"
  >
    <div
      class="tw-w-full tw-h-[3px] tw-bg-gray-200 tw-relative tw-overflow-x-hidden"
    >
      <div
        class="tw-h-full tw-bg-blue-500 tw-relative"
        :style="{
          width: `${displayPercentage}%`,
          transition: shouldAnimate
            ? 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
        }"
      >
        <div
          class="tw-absolute tw-inset-0 tw-bg-gradient-to-r tw-from-transparent tw-via-white/40 tw-to-transparent"
          :style="{
            animation: 'shimmer 1.5s infinite linear',
            width: '200%',
            left: '-100%',
          }"
        ></div>
      </div>
      <!-- Moving circle indicator -->
      <div
        class="tw-absolute tw-top-0 tw-w-[3px] tw-h-[2px] tw-rounded-full tw-bg-blue-500 tw-shadow-[0_0_10px_2px_rgba(59,130,246,0.5)] tw-transform tw-translate-x-[-50%]"
        :style="{
          left: `${displayPercentage}%`,
          transition: shouldAnimate
            ? 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
        }"
      >
        <div
          class="tw-absolute tw-inset-0 tw-rounded-full tw-bg-white/20 tw-animate-pulse"
        ></div>
      </div>
    </div>
    <div class="tw-absolute tw-top-2 tw-right-2 tw-text-xs tw-text-gray-600">
      <!-- {{ Math.round(displayPercentage * 100) }}% -->
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from "vue";

export default defineComponent({
  name: "LoadingProgress",
  props: {
    loading: {
      type: Boolean,
      required: true,
    },
    percent: {
      type: Number,
      required: true,
    },
  },

  setup(props) {
    const lastLoadingState = ref(props.loading);
    const internalPercentage = ref(props.percent);
    const isFadingOut = ref(false);
    let fadeOutTimeout: number;

    watch(
      () => props.loading,
      (newValue, oldValue) => {
        if (oldValue && !newValue) {
          // When loading becomes false, quickly complete to 100% and start fade out
          internalPercentage.value = 1;
          isFadingOut.value = true;

          clearTimeout(fadeOutTimeout);
          fadeOutTimeout = window.setTimeout(() => {
            isFadingOut.value = false;
            internalPercentage.value = 0;
          }, 500); // Match the fade-out duration
        }
      },
    );

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
      return props.percent;
    });

    return {
      displayPercentage,
      shouldAnimate,
      isFadingOut,
    };
  },
});
</script>

<style>
@keyframes shimmer {
  0% {
    transform: translateX(0%);
  }
  100% {
    transform: translateX(100%);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 0.4;
  }
}

.tw-animate-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
