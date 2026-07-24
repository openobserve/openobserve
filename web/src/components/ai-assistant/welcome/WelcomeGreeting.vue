<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useGreeting } from "./useGreeting";
import { getImageURL } from "@/utils/zincutils";
import { useTheme } from "@/composables/useTheme";

const store = useStore();
const { t } = useI18n();

const email = computed<string>(() => store.state.userInfo?.email ?? "");
const role = computed<string>(() => store.state.currentuser?.role ?? "");

const { greeting } = useGreeting(() => email.value);

const { isDark } = useTheme();
const logoSrc = computed(() =>
  isDark.value
    ? getImageURL("images/common/o2_ai_logo_dark.svg")
    : getImageURL("images/common/o2_ai_logo.svg"),
);
</script>

<template>
  <header class="welcome-hero flex max-w-[44rem] flex-col items-center gap-2.5 text-center">
    <div class="welcome-hero__row flex items-center gap-3.5">
      <div class="welcome-hero__logo-wrap relative inline-flex">
        <span
          class="welcome-hero__logo-halo pointer-events-none absolute inset-[-18px] z-0 rounded-full bg-[radial-gradient(closest-side,rgba(123,97,255,0.35),rgba(245,158,11,0.12)_55%,transparent_70%)] blur-[14px]"
          aria-hidden="true"
        ></span>
        <img
          :src="logoSrc"
          :alt="t('aiAssistant.welcome.taglineHighlight')"
          class="welcome-hero__logo relative z-1 h-14 w-14"
        />
      </div>

      <div class="welcome-hero__heading-block flex items-center">
        <div
          class="welcome-hero__title text-typography-body m-0 flex items-center gap-2 text-3xl leading-[1.15] font-bold tracking-[-0.01em]"
        >
          {{ greeting }}
          <span
            class="welcome-hero__wave inline-block [transform-origin:70%_70%] text-2xl leading-none"
            aria-hidden="true"
            >{{ t("aiAssistant.welcome.wave") }}</span
          >
        </div>
      </div>
    </div>

    <div
      class="welcome-hero__tagline text-typography-meta m-0 mt-1 max-w-[38rem] text-sm leading-[1.6]"
    >
      {{ t("aiAssistant.welcome.taglineLead") }}
      <span
        class="welcome-hero__highlight bg-[image:var(--color-gradient-brand-ribbon)] [background-clip:text] font-semibold text-transparent [-webkit-background-clip:text]"
        >{{ t("aiAssistant.welcome.taglineHighlight") }}</span
      >{{ t("aiAssistant.welcome.taglineTail") }}
      <span
        class="welcome-hero__code welcome-hero__code--sql rounded-default text-lang-sql-text bg-lang-sql-bg px-1.5 py-px font-mono text-xs font-semibold tracking-[0.01em]"
        >{{ t("aiAssistant.welcome.taglineSql") }}</span
      >,
      <span
        class="welcome-hero__code welcome-hero__code--vrl rounded-default text-lang-vrl-text bg-lang-vrl-bg px-1.5 py-px font-mono text-xs font-semibold tracking-[0.01em]"
        >{{ t("aiAssistant.welcome.taglineVrl") }}</span
      >
      {{ t("common.and") }}
      <span
        class="welcome-hero__code welcome-hero__code--promql rounded-default text-lang-promql-text bg-lang-promql-bg px-1.5 py-px font-mono text-xs font-semibold tracking-[0.01em]"
        >{{ t("aiAssistant.welcome.taglinePromql") }}</span
      >
      {{ t("aiAssistant.welcome.taglineDash") }} {{ t("aiAssistant.welcome.taglineAnd") }}
    </div>

    <div
      v-if="email"
      class="welcome-hero__meta text-2xs mt-1.5 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] px-3 py-1.5"
    >
      <span class="welcome-hero__meta-item inline-flex items-center gap-1">
        <span class="welcome-hero__meta-label text-typography-meta">{{
          t("aiAssistant.welcome.signedInAs")
        }}</span>
        <span class="welcome-hero__meta-value text-typography-body font-semibold">{{ email }}</span>
      </span>
      <span
        v-if="role"
        class="welcome-hero__meta-dot text-typography-meta opacity-50"
        aria-hidden="true"
        >·</span
      >
      <span v-if="role" class="welcome-hero__meta-item inline-flex items-center gap-1">
        <span class="welcome-hero__meta-label text-typography-meta">{{
          t("aiAssistant.welcome.role")
        }}</span>
        <span class="welcome-hero__meta-value text-typography-body font-semibold">{{ role }}</span>
      </span>
    </div>
  </header>
</template>

<style scoped>
/* keep(keyframes): the 👋 wave is this component's alone. The `animation` must be
   declared here rather than as a template `[animation:…]` utility — Vue's scoped
   compiler renames the keyframe and this declaration together, but never rewrites
   class strings in the template. */
.welcome-hero__wave {
  animation: wave 2.4s ease-in-out 0.4s 2;
}

@keyframes wave {
  0%,
  100% {
    transform: rotate(0deg);
  }
  20% {
    transform: rotate(14deg);
  }
  40% {
    transform: rotate(-8deg);
  }
  60% {
    transform: rotate(10deg);
  }
  80% {
    transform: rotate(-4deg);
  }
}
</style>
