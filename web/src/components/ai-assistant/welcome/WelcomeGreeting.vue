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
  <header class="welcome-hero">
    <div class="welcome-hero__row">
      <div class="welcome-hero__logo-wrap">
        <span class="welcome-hero__logo-halo" aria-hidden="true"></span>
        <img :src="logoSrc" alt="O2 Assistant" class="welcome-hero__logo" />
      </div>

      <div class="welcome-hero__heading-block">
        <h1 class="welcome-hero__title">
          {{ greeting }}
          <span class="welcome-hero__wave" aria-hidden="true">👋</span>
        </h1>
      </div>
    </div>

    <p class="welcome-hero__tagline">
      {{ t("aiAssistant.welcome.taglineLead") }}
      <span class="welcome-hero__highlight">{{
        t("aiAssistant.welcome.taglineHighlight")
      }}</span
      >{{ t("aiAssistant.welcome.taglineTail") }}
      <span class="welcome-hero__code welcome-hero__code--sql">{{
        t("aiAssistant.welcome.taglineSql")
      }}</span>,
      <span class="welcome-hero__code welcome-hero__code--vrl">{{
        t("aiAssistant.welcome.taglineVrl")
      }}</span>
      and
      <span class="welcome-hero__code welcome-hero__code--promql">{{
        t("aiAssistant.welcome.taglinePromql")
      }}</span>
      — {{ t("aiAssistant.welcome.taglineAnd") }}
    </p>

    <div v-if="email" class="welcome-hero__meta">
      <span class="welcome-hero__meta-item">
        <span class="welcome-hero__meta-label">{{
          t("aiAssistant.welcome.signedInAs")
        }}</span>
        <span class="welcome-hero__meta-value">{{ email }}</span>
      </span>
      <span v-if="role" class="welcome-hero__meta-dot" aria-hidden="true"
        >·</span
      >
      <span v-if="role" class="welcome-hero__meta-item">
        <span class="welcome-hero__meta-label">{{
          t("aiAssistant.welcome.role")
        }}</span>
        <span class="welcome-hero__meta-value">{{ role }}</span>
      </span>
    </div>
  </header>
</template>

<style scoped lang="scss">
.welcome-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.625rem;
  max-width: 44rem;
}

.welcome-hero__row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.welcome-hero__logo-wrap {
  position: relative;
  display: inline-flex;
}

.welcome-hero__logo-halo {
  position: absolute;
  inset: -18px;
  border-radius: 9999px;
  background: radial-gradient(
    closest-side,
    rgba(123, 97, 255, 0.35),
    rgba(245, 158, 11, 0.12) 55%,
    transparent 70%
  );
  filter: blur(14px);
  pointer-events: none;
  z-index: 0;
}

.welcome-hero__logo {
  position: relative;
  z-index: 1;
  width: 56px;
  height: 56px;
}

.welcome-hero__heading-block {
  display: flex;
  align-items: center;
}

.welcome-hero__title {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  color: var(--color-typography-body);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.welcome-hero__wave {
  font-size: 26px;
  line-height: 1;
  display: inline-block;
  animation: wave 2.4s ease-in-out 0.4s 2;
  transform-origin: 70% 70%;
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

.welcome-hero__tagline {
  margin: 0.25rem 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--color-typography-meta);
  max-width: 38rem;
}

.welcome-hero__highlight {
  font-weight: 600;
  background: linear-gradient(90deg, #f59e0b, #ec4899, #7b61ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.welcome-hero__code {
  font-size: 12px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.01em;
}

.welcome-hero__code--sql {
  color: #7b61ff;
  background: rgba(123, 97, 255, 0.1);
}

.welcome-hero__code--vrl {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}

.welcome-hero__code--promql {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}

.welcome-hero__meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.375rem 0.5rem;
  margin-top: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  background: color-mix(
    in srgb,
    var(--color-border-default) 30%,
    transparent
  );
  font-size: 11.5px;
}

.welcome-hero__meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.welcome-hero__meta-label {
  color: var(--color-typography-meta);
}

.welcome-hero__meta-value {
  color: var(--color-typography-body);
  font-weight: 600;
}

.welcome-hero__meta-dot {
  color: var(--color-typography-meta);
  opacity: 0.5;
}
</style>
