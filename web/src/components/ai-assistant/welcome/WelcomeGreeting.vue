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
  <header class="welcome-hero flex flex-col items-center text-center gap-2.5 max-w-[44rem]">
    <div class="welcome-hero__row flex items-center gap-3.5">
      <div class="welcome-hero__logo-wrap relative inline-flex">
        <span class="welcome-hero__logo-halo absolute inset-[-18px] rounded-full bg-[radial-gradient(closest-side,rgba(123,97,255,0.35),rgba(245,158,11,0.12)_55%,transparent_70%)] blur-[14px] pointer-events-none z-0" aria-hidden="true"></span>
        <img :src="logoSrc" alt="O2 Assistant" class="welcome-hero__logo relative z-1 w-14 h-14" />
      </div>

      <div class="welcome-hero__heading-block flex items-center">
        <div class="welcome-hero__title m-0 text-3xl font-bold tracking-[-0.01em] leading-[1.15] text-typography-body flex items-center gap-2">
          {{ greeting }}
          <span class="welcome-hero__wave text-2xl leading-none inline-block [transform-origin:70%_70%]" aria-hidden="true">👋</span>
        </div>
      </div>
    </div>

    <div class="welcome-hero__tagline mt-1 text-sm leading-[1.6] text-typography-meta max-w-[38rem] m-0">
      {{ t("aiAssistant.welcome.taglineLead") }}
      <span class="welcome-hero__highlight font-semibold bg-[image:var(--color-gradient-brand-ribbon)] [background-clip:text] [-webkit-background-clip:text] text-transparent">{{
        t("aiAssistant.welcome.taglineHighlight")
      }}</span
      >{{ t("aiAssistant.welcome.taglineTail") }}
      <span class="welcome-hero__code welcome-hero__code--sql font-mono text-xs font-semibold py-px px-1.5 rounded-default tracking-[0.01em] text-lang-sql-text bg-lang-sql-bg">{{
        t("aiAssistant.welcome.taglineSql")
      }}</span>,
      <span class="welcome-hero__code welcome-hero__code--vrl font-mono text-xs font-semibold py-px px-1.5 rounded-default tracking-[0.01em] text-lang-vrl-text bg-lang-vrl-bg">{{
        t("aiAssistant.welcome.taglineVrl")
      }}</span>
      and
      <span class="welcome-hero__code welcome-hero__code--promql font-mono text-xs font-semibold py-px px-1.5 rounded-default tracking-[0.01em] text-lang-promql-text bg-lang-promql-bg">{{
        t("aiAssistant.welcome.taglinePromql")
      }}</span>
      — {{ t("aiAssistant.welcome.taglineAnd") }}
    </div>

    <div v-if="email" class="welcome-hero__meta inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 mt-1.5 py-1.5 px-3 rounded-full bg-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] text-2xs">
      <span class="welcome-hero__meta-item inline-flex items-center gap-1">
        <span class="welcome-hero__meta-label text-typography-meta">{{
          t("aiAssistant.welcome.signedInAs")
        }}</span>
        <span class="welcome-hero__meta-value text-typography-body font-semibold">{{ email }}</span>
      </span>
      <span v-if="role" class="welcome-hero__meta-dot text-typography-meta opacity-50" aria-hidden="true"
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

