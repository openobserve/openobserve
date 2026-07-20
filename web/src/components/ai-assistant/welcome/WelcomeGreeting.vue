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
  <header class="welcome-hero flex flex-col items-center text-center gap-[0.625rem] max-w-[44rem]">
    <div class="welcome-hero__row flex items-center gap-[0.875rem]">
      <div class="welcome-hero__logo-wrap relative inline-flex">
        <span class="welcome-hero__logo-halo absolute inset-[-18px] rounded-full bg-[radial-gradient(closest-side,rgba(123,97,255,0.35),rgba(245,158,11,0.12)_55%,transparent_70%)] blur-[14px] pointer-events-none z-0" aria-hidden="true"></span>
        <img :src="logoSrc" alt="O2 Assistant" class="welcome-hero__logo relative z-1 w-14 h-14" />
      </div>

      <div class="welcome-hero__heading-block flex items-center">
        <div class="welcome-hero__title m-0 text-[32px] font-bold tracking-[-0.01em] leading-[1.15] text-[var(--color-typography-body)] flex items-center gap-2">
          {{ greeting }}
          <span class="welcome-hero__wave text-[26px] leading-none inline-block [animation:wave_2.4s_ease-in-out_0.4s_2] [transform-origin:70%_70%]" aria-hidden="true">👋</span>
        </div>
      </div>
    </div>

    <div class="welcome-hero__tagline mt-1 text-[13.5px] leading-[1.6] text-[var(--color-typography-meta)] max-w-[38rem] m-0">
      {{ t("aiAssistant.welcome.taglineLead") }}
      <span class="welcome-hero__highlight font-semibold bg-[linear-gradient(90deg,#f59e0b,#ec4899,#7b61ff)] [background-clip:text] [-webkit-background-clip:text] text-transparent">{{
        t("aiAssistant.welcome.taglineHighlight")
      }}</span
      >{{ t("aiAssistant.welcome.taglineTail") }}
      <span class="welcome-hero__code welcome-hero__code--sql font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] text-xs font-semibold py-[1px] px-[6px] rounded tracking-[0.01em] text-[#7b61ff] bg-[rgba(123,97,255,0.1)]">{{
        t("aiAssistant.welcome.taglineSql")
      }}</span>,
      <span class="welcome-hero__code welcome-hero__code--vrl font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] text-xs font-semibold py-[1px] px-[6px] rounded tracking-[0.01em] text-[#f59e0b] bg-[rgba(245,158,11,0.12)]">{{
        t("aiAssistant.welcome.taglineVrl")
      }}</span>
      and
      <span class="welcome-hero__code welcome-hero__code--promql font-[var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] text-xs font-semibold py-[1px] px-[6px] rounded tracking-[0.01em] text-[#10b981] bg-[rgba(16,185,129,0.12)]">{{
        t("aiAssistant.welcome.taglinePromql")
      }}</span>
      — {{ t("aiAssistant.welcome.taglineAnd") }}
    </div>

    <div v-if="email" class="welcome-hero__meta inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.375rem] mt-[0.375rem] py-[0.375rem] px-3 rounded-full bg-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] text-[11.5px]">
      <span class="welcome-hero__meta-item inline-flex items-center gap-1">
        <span class="welcome-hero__meta-label text-[var(--color-typography-meta)]">{{
          t("aiAssistant.welcome.signedInAs")
        }}</span>
        <span class="welcome-hero__meta-value text-[var(--color-typography-body)] font-semibold">{{ email }}</span>
      </span>
      <span v-if="role" class="welcome-hero__meta-dot text-[var(--color-typography-meta)] opacity-50" aria-hidden="true"
        >·</span
      >
      <span v-if="role" class="welcome-hero__meta-item inline-flex items-center gap-1">
        <span class="welcome-hero__meta-label text-[var(--color-typography-meta)]">{{
          t("aiAssistant.welcome.role")
        }}</span>
        <span class="welcome-hero__meta-value text-[var(--color-typography-body)] font-semibold">{{ role }}</span>
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
