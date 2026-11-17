<template>
  <div
    class="absolute top-0 left-0 z-999 w-full transition-opacity duration-500 ease-out"
    v-bind="ariaAttrs"
    :class="{
      'opacity-0': !loading && !isFadingOut,
      'opacity-100': loading || isFadingOut,
    }"
  >
    <div class="bg-progress-bar-track relative h-0.5 w-full overflow-x-hidden">
      <div
        v-if="travelling"
        class="loading-progress__travel o2-motion-keep bg-accent h-full w-1/3"
        data-test="loading-progress-travel"
      ></div>
      <div
        v-else-if="!travelMode"
        class="o2-motion-keep bg-brand-indigo relative h-full overflow-hidden"
        :style="{
          width: `${displayPercentage}%`,
          transition: shouldAnimate ? `width ${PROGRESS_STEP} ${PROGRESS_EASE}` : 'none',
          willChange: loading ? 'width' : 'auto',
          transform: 'translateZ(0)', // Force GPU acceleration
        }"
      >
        <div
          v-if="!determinate"
          class="loading-progress__shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        ></div>
      </div>
      <!-- Moving circle indicator; moved with transform because animating `left` is a layout shift. -->
      <div
        v-if="!travelMode"
        class="o2-motion-keep pointer-events-none absolute inset-0"
        :style="{
          transform: `translateX(${displayPercentage}%)`,
          transition: shouldAnimate ? `transform ${PROGRESS_STEP} ${PROGRESS_EASE}` : 'none',
        }"
      >
        <div
          class="bg-brand-indigo ring-brand-indigo/50 absolute top-0 left-0 h-0.5 w-0.75 -translate-x-1/2 transform rounded-full ring-2"
        >
          <div
            v-if="!determinate"
            class="loading-progress__head-glow absolute inset-0 rounded-full bg-white/20"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onUnmounted } from "vue";

const PROGRESS_STEP = "calc(0.3s * var(--motion-slowdown))";
const PROGRESS_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

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
    /** Determinate progress (0–100) when the work is countable; it never moves back within a run. */
    value: {
      type: Number,
      default: undefined,
    },
    /** Accessible name; set, the line is a `progressbar` ("Loading spans…"). */
    label: {
      type: String,
      default: undefined,
    },
    /** Spoken value of a determinate line, e.g. "3 of 12 partitions". */
    valueText: {
      type: String,
      default: undefined,
    },
    /** No countable progress: a segment travels the track, still moving (slower) under reduced motion. */
    indeterminate: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const lastLoadingState = ref(props.loading);
    const internalPercentage = ref(props.loadingProgressPercentage);
    const isFadingOut = ref(false);
    const isSettling = ref(false);
    let fadeOutTimeout: number;
    const determinate = computed(() => typeof props.value === "number");
    const travelMode = computed(() => props.indeterminate && !determinate.value);
    const highWater = ref(0);

    // A new dismissal replaces the pending one, so it must also undo what that cancelled timer would have reset.
    const cancelDismissal = () => {
      clearTimeout(fadeOutTimeout);
      isFadingOut.value = false;
      isSettling.value = false;
      internalPercentage.value = 0;
    };

    watch(
      () => props.loading,
      (newValue, oldValue) => {
        // Remember the previous loading state so shouldAnimate can stay
        // true through the loading -> not-loading transition.
        lastLoadingState.value = oldValue;
        if (newValue && !oldValue) highWater.value = 0;

        if (oldValue && !newValue && travelMode.value) {
          // Unknown progress has nothing to complete: the root fades now and the segment stays until the fade ends.
          cancelDismissal();
          isSettling.value = true;
          fadeOutTimeout = window.setTimeout(() => {
            isSettling.value = false;
          }, 500);
        } else if (oldValue && !newValue) {
          cancelDismissal();
          // When loading becomes false, quickly complete to 100% and start fade out
          internalPercentage.value = 100;
          isFadingOut.value = true;

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

    // Unknown progress never completes, so the segment fades out where it is instead of filling the track.
    const travelling = computed(() => travelMode.value && (props.loading || isSettling.value));

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
      if (determinate.value) return Math.max(5, highWater.value);
      if (props.loadingProgressPercentage < 5) {
        return 5;
      }
      return props.loadingProgressPercentage;
    });

    // A determinate line only moves forward; a lower late value must not refill it.
    watch(
      () => [props.value, props.loading] as const,
      ([value, loading]) => {
        if (!loading || typeof value !== "number") return;
        highWater.value = Math.max(highWater.value, Math.min(100, Math.max(0, value)));
      },
      { immediate: true },
    );

    const ariaAttrs = computed(() => {
      if (!props.label) return {};
      return {
        role: "progressbar",
        "aria-label": props.label,
        "aria-hidden": props.loading ? undefined : "true",
        ...(determinate.value
          ? {
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(highWater.value),
              "aria-valuetext": props.valueText,
            }
          : {}),
      };
    });

    return {
      ariaAttrs,
      determinate,
      displayPercentage,
      shouldAnimate,
      travelling,
      travelMode,
      isFadingOut,
      PROGRESS_STEP,
      PROGRESS_EASE,
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
  left: 0;
  animation: shimmer 1.5s infinite linear;
}

.loading-progress__head-glow {
  animation: head-glow-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* keep(keyframes): the indeterminate segment keeps travelling under reduced motion, 4x slower (ruling 14). */
.loading-progress__travel {
  animation: travel calc(1.5s * var(--motion-slowdown)) ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    transform: translateX(-300%);
  }
  100% {
    transform: translateX(100%);
  }
}

@keyframes travel {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
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
