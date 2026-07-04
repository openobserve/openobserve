<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useGreeting } from "./useGreeting";
import { getImageURL } from "@/utils/zincutils";

const store = useStore();
const { t } = useI18n();

const email = computed<string>(() => store.state.userInfo?.email ?? "");
const role = computed<string>(() => store.state.currentuser?.role ?? "");

const { greeting } = useGreeting(() => email.value);

const logoSrc = computed(() =>
  store.state.theme === "dark"
    ? getImageURL("images/common/o2_ai_logo_dark.svg")
    : getImageURL("images/common/o2_ai_logo.svg"),
);
</script>

<template>
  <header class="welcome-hero tw:flex tw:flex-col tw:items-center tw:text-center tw:gap-[0.625rem] tw:max-w-[44rem]">
    <div class="welcome-hero__row tw:flex tw:items-center tw:gap-[0.875rem]">
      <div class="welcome-hero__logo-wrap tw:relative tw:inline-flex">
        <span class="welcome-hero__logo-halo tw:absolute tw:inset-[-18px] tw:rounded-full tw:bg-[radial-gradient(closest-side,rgba(123,97,255,0.35),rgba(245,158,11,0.12)_55%,transparent_70%)] tw:blur-[14px] tw:pointer-events-none tw:z-0" aria-hidden="true"></span>
        <img :src="logoSrc" alt="O2 Assistant" class="welcome-hero__logo tw:relative tw:z-1 tw:w-14 tw:h-14" />
      </div>

      <div class="welcome-hero__heading-block tw:flex tw:items-center">
        <div class="welcome-hero__title tw:m-0 tw:text-[32px] tw:font-bold tw:tracking-[-0.01em] tw:leading-[1.15] tw:text-[var(--color-typography-body)] tw:flex tw:items-center tw:gap-2">
          {{ greeting }}
          <span class="welcome-hero__wave tw:text-[26px] tw:leading-none tw:inline-block tw:[animation:wave_2.4s_ease-in-out_0.4s_2] tw:[transform-origin:70%_70%]" aria-hidden="true">👋</span>
        </div>
      </div>
    </div>

    <div class="welcome-hero__tagline tw:mt-1 tw:text-[13.5px] tw:leading-[1.6] tw:text-[var(--color-typography-meta)] tw:max-w-[38rem] tw:m-0">
      {{ t("aiAssistant.welcome.taglineLead") }}
      <span class="welcome-hero__highlight tw:font-semibold tw:bg-[linear-gradient(90deg,#f59e0b,#ec4899,#7b61ff)] tw:[background-clip:text] tw:[-webkit-background-clip:text] tw:text-transparent">{{
        t("aiAssistant.welcome.taglineHighlight")
      }}</span
      >{{ t("aiAssistant.welcome.taglineTail") }}
      <span class="welcome-hero__code welcome-hero__code--sql tw:font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] tw:text-xs tw:font-semibold tw:py-[1px] tw:px-[6px] tw:rounded tw:tracking-[0.01em] tw:text-[#7b61ff] tw:bg-[rgba(123,97,255,0.1)]">{{
        t("aiAssistant.welcome.taglineSql")
      }}</span>,
      <span class="welcome-hero__code welcome-hero__code--vrl tw:font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] tw:text-xs tw:font-semibold tw:py-[1px] tw:px-[6px] tw:rounded tw:tracking-[0.01em] tw:text-[#f59e0b] tw:bg-[rgba(245,158,11,0.12)]">{{
        t("aiAssistant.welcome.taglineVrl")
      }}</span>
      and
      <span class="welcome-hero__code welcome-hero__code--promql tw:font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] tw:text-xs tw:font-semibold tw:py-[1px] tw:px-[6px] tw:rounded tw:tracking-[0.01em] tw:text-[#10b981] tw:bg-[rgba(16,185,129,0.12)]">{{
        t("aiAssistant.welcome.taglinePromql")
      }}</span>
      — {{ t("aiAssistant.welcome.taglineAnd") }}
    </div>

    <div v-if="email" class="welcome-hero__meta tw:inline-flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-x-2 tw:gap-y-[0.375rem] tw:mt-[0.375rem] tw:py-[0.375rem] tw:px-3 tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] tw:text-[11.5px]">
      <span class="welcome-hero__meta-item tw:inline-flex tw:items-center tw:gap-1">
        <span class="welcome-hero__meta-label tw:text-[var(--color-typography-meta)]">{{
          t("aiAssistant.welcome.signedInAs")
        }}</span>
        <span class="welcome-hero__meta-value tw:text-[var(--color-typography-body)] tw:font-semibold">{{ email }}</span>
      </span>
      <span v-if="role" class="welcome-hero__meta-dot tw:text-[var(--color-typography-meta)] tw:opacity-50" aria-hidden="true"
        >·</span
      >
      <span v-if="role" class="welcome-hero__meta-item tw:inline-flex tw:items-center tw:gap-1">
        <span class="welcome-hero__meta-label tw:text-[var(--color-typography-meta)]">{{
          t("aiAssistant.welcome.role")
        }}</span>
        <span class="welcome-hero__meta-value tw:text-[var(--color-typography-body)] tw:font-semibold">{{ role }}</span>
      </span>
    </div>
  </header>
</template>

<style>
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
