<template>
  <div
    class="tw:absolute tw:top-0 tw:left-0 tw:w-full tw:z-[999] tw:transition-opacity tw:duration-500 tw:ease-out"
    :class="{
      'tw:opacity-0': !loading && !isFadingOut,
      'tw:opacity-100': loading || isFadingOut,
    }"
  >
    <div
      class="tw:w-full tw:h-[2px] tw:relative tw:overflow-x-hidden"
      :class="
        store.state.theme === 'dark' ? 'tw:bg-gray-700' : 'tw:bg-gray-200'
      "
    >
      <div
        class="tw:h-full tw:relative tw:overflow-hidden"
        :class="
          store.state.theme === 'dark' ? 'tw:bg-[#5960B2]' : 'tw:bg-[#5960B2]'
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
          class="tw:absolute tw:inset-0 tw:bg-gradient-to-r tw:from-transparent tw:to-transparent "
          :class="
            store.state.theme === 'dark'
              ? 'tw:via-gray-300/40'
              : 'tw:via-white/40'
          "
          :style="{
            animation: 'shimmer 1.5s infinite linear',
            width: '200%',
            left: '-200%',
          }"
        ></div>
      </div>
      <!-- Moving circle indicator -->
      <div
        class="tw:absolute tw:top-0 tw:w-[3px] tw:h-[2px] tw:rounded-full tw:shadow-[0_0_10px_2px_rgba(89,96,178,0.5)] tw:transform tw:translate-x-[-50%]"
        :class="
          store.state.theme === 'dark' ? 'tw:bg-[#5960B2]' : 'tw:bg-[#5960B2]'
        "
        :style="{
          left: `${displayPercentage}%`,
          transition: shouldAnimate
            ? 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
        }"
      >
        <div
          class="tw:absolute tw:inset-0 tw:rounded-full tw:animate-pulse"
          :class="
            store.state.theme === 'dark'
              ? 'tw:bg-gray-300/20'
              : 'tw:bg-white/20'
          "
        ></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onUnmounted } from "vue";
import { useStore } from "vuex";

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
    const store = useStore();
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
      store,
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
    transform: translateX(-200%);
  }
  100% {
    transform: translateX(200%);
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

.tw:animate-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
