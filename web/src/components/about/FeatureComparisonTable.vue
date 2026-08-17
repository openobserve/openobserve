<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="mb-2 flex items-start gap-3">
      <div
        data-test="feature-comparison-table-icon-wrapper"
        class="rounded-default text-accent bg-card-glass-tint-medium flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <OIcon name="compare-arrows" size="md" />
      </div>
      <div>
        <div
          class="text-accent m-0 mb-0.5 text-[length:var(--text-xs)] font-semibold tracking-[0.1em] uppercase"
        >
          {{ t("about.editionsLabel") }}
        </div>
        <div
          class="text-text-heading m-0 text-[length:var(--text-xl)] font-semibold tracking-[-0.015em]"
        >
          {{ t("about.feature_comparison_lbl") }}
        </div>
      </div>
    </div>
    <div class="text-typography-body mt-2 text-sm leading-relaxed font-normal">
      <template v-if="buildType === 'opensource'">{{
        t("about.feature_comparision_os_msg")
      }}</template>
      <template v-else-if="buildType === 'enterprise'">{{
        t("about.feature_comparision_ent_msg")
      }}</template>
      <template v-else>{{ t("about.feature_comparision_subtitle") }}</template>
    </div>

    <!-- ── Edition Cards Grid ──────────────────────────────────────────── -->
    <div class="grid grid-cols-3 gap-5 pt-4">
      <!-- eslint-disable local/no-hardcoded-px -- query condition: a threshold for WHEN layout changes, not a rendered length -->
      <div
        v-for="ed in editionList"
        :key="ed.id"
        data-test="feature-comparison-table-edition-card"
        :data-test-active="buildType === ed.id ? 'true' : undefined"
        class="bg-card-glass-bg rounded-default border-card-glass-border relative flex flex-col border p-6 max-[1024px]:p-4"
        :class="{ 'border-accent border-2 pt-7 max-[1024px]:pt-5': buildType === ed.id }"
      >
        <!-- eslint-enable local/no-hardcoded-px -->
        <!-- Your Plan badge (floats above the card top border) -->
        <div
          v-if="buildType === ed.id"
          data-test="feature-comparison-table-your-plan-badge"
          class="text-3xs bg-accent text-button-primary-foreground absolute top-[-0.875rem] left-1/2 inline-flex -translate-x-1/2 items-center rounded-full px-3.5 py-1 font-bold tracking-[0.08em] whitespace-nowrap uppercase"
        >
          <OIcon name="arrow-upward" size="sm" class="mr-1" />
          {{ t("about.yourPlan") }}
        </div>

        <!-- Edition name + hosting + price ────────────────────────────── -->
        <div class="mb-5">
          <div class="text-text-heading m-0 mb-0.5 text-base font-bold">{{ ed.shortName }}</div>
          <div class="text-compact text-text-secondary m-0 mb-3.5">{{ ed.hosting }}</div>
          <div class="text-accent m-0 mb-1 text-3xl leading-[1.1] font-bold tracking-[-0.03em]">
            {{ ed.price }}
          </div>
          <div class="text-compact text-text-secondary m-0 leading-[1.4]">{{ ed.priceSub }}</div>
        </div>

        <!-- All Five Pillars chips ────────────────────────────────────── -->
        <div class="rounded-default border-accent/15 bg-card-glass-tint-subtle mb-4 border p-3">
          <div class="text-3xs text-text-label m-0 mb-2 font-bold tracking-[0.12em] uppercase">
            {{ t("about.allFivePillars") }}
          </div>
          <div class="mb-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="pillarId in PILLAR_IDS"
              :key="pillarId"
              data-test="feature-comparison-table-pillar-chip"
              class="rounded-default text-2xs text-accent border-accent/20 bg-card-glass-tint mr-1.5 mb-1.5 inline-flex items-center border px-2 py-[0.1875rem] font-medium"
            >
              {{ t(`about.feature_${pillarId}`) }}
            </span>
          </div>
          <span
            class="rounded-default text-2xs text-accent border-accent/20 bg-card-glass-tint mr-1.5 mb-1.5 inline-flex items-center border px-2 py-[0.1875rem] font-medium"
            >{{ t("about.feature_dashboards") }}</span
          >
        </div>

        <!-- Feature list ───────────────────────────────────────────────── -->
        <ul class="m-0 flex-1 list-none p-0">
          <li
            v-for="feature in listFeatures"
            :key="feature.id"
            data-test="feature-comparison-table-feature-item"
            class="text-compact border-card-glass-border flex items-start gap-2 border-b py-[0.4375rem] last:border-b-0"
            :class="{
              'text-text-body': getFeatureStatus(feature, ed.id) !== 'unavailable',
              'text-text-muted': getFeatureStatus(feature, ed.id) === 'unavailable',
            }"
          >
            <span
              class="mt-0.5 shrink-0 leading-none"
              :class="{
                'text-status-positive': getFeatureStatus(feature, ed.id) !== 'unavailable',
                'text-text-muted': getFeatureStatus(feature, ed.id) === 'unavailable',
              }"
            >
              <OIcon
                v-if="getFeatureStatus(feature, ed.id) !== 'unavailable'"
                name="check-circle"
                size="sm"
              />
              <OIcon v-else name="cancel" size="sm" />
            </span>
            <span class="flex flex-col gap-[0.0625rem]">
              <span class="leading-[1.45]">{{ t(getFeatureNameKey(feature)) }}</span>
              <span v-if="getFeatureNote(feature, ed.id)" class="text-2xs text-text-muted italic">
                {{ getFeatureNote(feature, ed.id) }}
              </span>
            </span>
          </li>
        </ul>

        <!-- Footer: license + support + CTA ──────────────────────────── -->
        <div class="mt-4">
          <div class="bg-card-glass-border mb-3 h-px"></div>
          <div class="mb-3.5">
            <div
              data-test="feature-comparison-table-footer-row"
              class="text-compact flex items-baseline justify-between py-0.5"
            >
              <span class="text-text-muted font-medium">{{ t("about.feature_license") }}</span>
              <span class="text-text-body font-semibold">{{ ed.license }}</span>
            </div>
            <div
              data-test="feature-comparison-table-footer-row"
              class="text-compact flex items-baseline justify-between py-0.5"
            >
              <span class="text-text-muted font-medium">{{ t("about.feature_support") }}</span>
              <span class="text-text-body font-semibold">{{ ed.support }}</span>
            </div>
          </div>
          <a
            v-if="ed.ctaUrl"
            :href="ed.ctaUrl"
            target="_blank"
            data-test="feature-comparison-table-cta-btn"
            data-test-cta="action"
            class="rounded-default text-accent hover:border-accent border-accent/30 bg-card-glass-tint hover:bg-card-glass-tint-strong block w-full cursor-pointer border border-solid px-4 py-2 text-center text-sm font-semibold no-underline transition-all duration-200"
          >
            {{ ed.ctaLabel }}
          </a>
          <button
            v-else
            data-test="feature-comparison-table-cta-btn"
            data-test-cta="current"
            class="rounded-default text-text-muted border-card-glass-border block w-full cursor-default border border-solid bg-transparent px-4 py-2 text-center text-sm font-semibold no-underline transition-all duration-200"
            disabled
          >
            {{ ed.ctaLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { FEATURE_REGISTRY, getFeatureNameKey, type FeatureDefinition } from "@/constants/features";

const store = useStore();
const { t } = useI18nTyped();

const buildType: string = store.state.zoConfig.build_type;

// Feature IDs shown as pillar chips (not repeated in the list below)
const PILLAR_IDS = ["logs", "metrics", "traces", "rum", "alerts"];
const EXCLUDED_FROM_LIST = new Set([
  "logs",
  "metrics",
  "traces",
  "rum",
  "alerts",
  "dashboards", // shown as extra chip
  "license", // shown in footer
  "support", // shown in footer
  "cost", // not shown in card layout
]);

// Features rendered as check/X rows inside each edition card
const listFeatures = computed(() => FEATURE_REGISTRY.filter((f) => !EXCLUDED_FROM_LIST.has(f.id)));

// ── Edition metadata ──────────────────────────────────────────────────────────

interface EditionMeta {
  id: string;
  shortName: I18nText;
  hosting: I18nText;
  price: I18nText;
  priceSub: I18nText;
  license: I18nText;
  support: I18nText;
  ctaLabel: I18nText;
  ctaUrl: string | null;
}

const editionList = computed((): EditionMeta[] => [
  {
    id: "opensource",
    shortName: raw("Open Source"),
    hosting: t("about.selfHosted"),
    price: t("about.value_cost_free"),
    priceSub: t("about.foreverNoLimits"),
    license: raw("AGPL"),
    support: t("about.value_support_community"),
    ctaLabel: buildType === "opensource" ? t("about.currentPlan") : t("about.learnMore"),
    ctaUrl: buildType === "opensource" ? null : "https://openobserve.ai",
  },
  {
    id: "enterprise",
    shortName: raw("Enterprise"),
    hosting: t("about.selfHosted"),
    price: t("about.value_cost_free"),
    priceSub: t("about.upToFiftyGbPaidBeyond"),
    license: t("about.value_license_enterprise"),
    support: t("about.value_support_enterprise"),
    ctaLabel: buildType === "enterprise" ? t("about.currentPlan") : t("about.download"),
    ctaUrl: buildType === "enterprise" ? null : "https://openobserve.ai/download",
  },
  {
    id: "cloud",
    shortName: raw("Cloud"),
    hosting: t("about.fullyManaged"),
    price: t("about.trialFourteenDay"),
    priceSub: t("about.usageBasedThereafter"),
    license: t("about.value_license_cloud"),
    support: t("about.value_support_cloud"),
    ctaLabel: buildType === "cloud" ? t("about.currentPlan") : t("about.startFreeTrial"),
    ctaUrl: buildType === "cloud" ? null : "https://cloud.openobserve.ai",
  },
]);

// ── Feature availability helpers ─────────────────────────────────────────────

type FeatureStatus = "available" | "unavailable" | "conditional";

function getFeatureStatus(feature: FeatureDefinition, editionId: string): FeatureStatus {
  const raw = feature.availability[editionId as keyof typeof feature.availability];
  if (raw === true) return "available";
  if (raw === false) return "unavailable";
  return "conditional"; // string value = available with a condition
}

function getFeatureNote(feature: FeatureDefinition, editionId: string): string {
  const raw = feature.availability[editionId as keyof typeof feature.availability];
  if (typeof raw !== "string") return "";
  // Translate the key and strip any leading emoji (e.g. "✅ ") so we show clean text
  return t(raw)
    .replace(/^[✅❌]\s*/u, "")
    .trim();
}
</script>
