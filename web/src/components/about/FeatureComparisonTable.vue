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
    <div class="tw:flex tw:items-start tw:gap-3 tw:mb-2">
      <div class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_12%,var(--o2-card-bg))] tw:text-(--o2-primary-color)">
        <OIcon name="compare-arrows" size="md" />
      </div>
      <div>
        <div class="tw:text-[length:var(--text-xs)] tw:font-semibold tw:uppercase tw:tracking-[0.1em] tw:text-(--o2-primary-color) tw:m-0 tw:mb-[0.125rem]">EDITIONS</div>
        <div class="tw:text-[length:var(--text-xl)] tw:font-semibold tw:text-(--color-text-heading) tw:m-0 tw:tracking-[-0.015em]">{{ t("about.feature_comparison_lbl") }}</div>
      </div>
    </div>
    <div class="tw:text-[length:var(--text-sm)] tw:leading-[1.65] tw:text-(--o2-text-secondary) tw:mt-2 tw:mb-8">
      <template v-if="buildType === 'opensource'">{{ t("about.feature_comparision_os_msg") }}</template>
      <template v-else-if="buildType === 'enterprise'">{{ t("about.feature_comparision_ent_msg") }}</template>
      <template v-else>{{ t("about.feature_comparision_subtitle") }}</template>
    </div>

    <!-- ── Edition Cards Grid ──────────────────────────────────────────── -->
    <div class="tw:grid tw:grid-cols-3 tw:gap-5 tw:pt-4">
      <div
        v-for="ed in editionList"
        :key="ed.id"
        class="tw:relative tw:flex tw:flex-col tw:bg-(--o2-card-bg) tw:rounded-xl tw:p-6 tw:max-[1024px]:p-4 tw:border tw:border-(--o2-border-color)"
        :class="{ 'tw:border-2 tw:border-(--o2-primary-color) tw:pt-7 tw:max-[1024px]:pt-5': buildType === ed.id }"
      >
        <!-- Your Plan badge (floats above the card top border) -->
        <div v-if="buildType === ed.id" class="tw:absolute tw:top-[-14px] tw:left-1/2 tw:-translate-x-1/2 tw:inline-flex tw:items-center tw:py-1 tw:px-[0.875rem] tw:rounded-full tw:text-[0.625rem] tw:font-bold tw:uppercase tw:tracking-[0.08em] tw:whitespace-nowrap tw:bg-(--o2-primary-color) tw:text-(--o2-primary-foreground)">
          <OIcon name="arrow-upward" size="sm" class="tw:mr-1" />
          Your Plan
        </div>

        <!-- Edition name + hosting + price ────────────────────────────── -->
        <div class="tw:mb-5">
          <div class="tw:text-base tw:font-bold tw:text-(--o2-text-heading) tw:m-0 tw:mb-[0.125rem]">{{ ed.shortName }}</div>
          <div class="tw:text-[0.8125rem] tw:text-(--o2-text-muted) tw:m-0 tw:mb-[0.875rem]">{{ ed.hosting }}</div>
          <div class="tw:text-[1.75rem] tw:font-bold tw:text-(--o2-primary-color) tw:m-0 tw:mb-1 tw:tracking-[-0.03em] tw:leading-[1.1]">{{ ed.price }}</div>
          <div class="tw:text-[0.8125rem] tw:text-(--o2-text-muted) tw:m-0 tw:leading-[1.4]">{{ ed.priceSub }}</div>
        </div>

        <!-- All Five Pillars chips ────────────────────────────────────── -->
        <div class="tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_5%,var(--o2-card-bg))] tw:border tw:border-[color-mix(in_srgb,var(--o2-primary-color)_15%,transparent)] tw:rounded-lg tw:p-3 tw:mb-4">
          <div class="tw:text-[0.5625rem] tw:font-bold tw:uppercase tw:tracking-[0.12em] tw:text-(--o2-text-label) tw:m-0 tw:mb-2">ALL FIVE PILLARS</div>
          <div class="tw:flex tw:flex-wrap tw:gap-1.5 tw:mb-1.5">
            <span v-for="pillarId in PILLAR_IDS" :key="pillarId" class="tw:inline-flex tw:items-center tw:py-[0.1875rem] tw:px-2 tw:rounded tw:text-[0.6875rem] tw:font-medium tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_10%,var(--o2-card-bg))] tw:text-(--o2-primary-color) tw:border tw:border-[color-mix(in_srgb,var(--o2-primary-color)_20%,transparent)] tw:mr-[0.375rem] tw:mb-[0.375rem]">
              {{ t(`about.feature_${pillarId}`) }}
            </span>
          </div>
          <span class="tw:inline-flex tw:items-center tw:py-[0.1875rem] tw:px-2 tw:rounded tw:text-[0.6875rem] tw:font-medium tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_10%,var(--o2-card-bg))] tw:text-(--o2-primary-color) tw:border tw:border-[color-mix(in_srgb,var(--o2-primary-color)_20%,transparent)] tw:mr-[0.375rem] tw:mb-[0.375rem]">{{ t('about.feature_dashboards') }}</span>
        </div>

        <!-- Feature list ───────────────────────────────────────────────── -->
        <ul class="tw:list-none tw:p-0 tw:m-0 tw:flex-1">
          <li
            v-for="feature in listFeatures"
            :key="feature.id"
            class="tw:flex tw:items-start tw:gap-2 tw:py-[0.4375rem] tw:text-[0.8125rem] tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0"
            :class="{
              'tw:text-[var(--o2-text-body)]': getFeatureStatus(feature, ed.id) !== 'unavailable',
              'tw:text-[var(--o2-text-muted)]': getFeatureStatus(feature, ed.id) === 'unavailable',
            }"
          >
            <span class="tw:shrink-0 tw:mt-[0.125rem] tw:leading-none"
              :class="{
                'tw:text-[var(--o2-positive)]': getFeatureStatus(feature, ed.id) !== 'unavailable',
                'tw:text-[var(--o2-text-muted)]': getFeatureStatus(feature, ed.id) === 'unavailable',
              }"
            >
              <OIcon
                v-if="getFeatureStatus(feature, ed.id) !== 'unavailable'"
                name="check-circle"
                size="sm"
              />
              <OIcon
                v-else
                name="cancel"
                size="sm"
              />
            </span>
            <span class="tw:flex tw:flex-col tw:gap-[0.0625rem]">
              <span class="tw:leading-[1.45]">{{ t(getFeatureNameKey(feature)) }}</span>
              <span v-if="getFeatureNote(feature, ed.id)" class="tw:text-[0.6875rem] tw:text-(--o2-text-muted) tw:italic">
                {{ getFeatureNote(feature, ed.id) }}
              </span>
            </span>
          </li>
        </ul>

        <!-- Footer: license + support + CTA ──────────────────────────── -->
        <div class="tw:mt-4">
          <div class="tw:h-px tw:bg-(--o2-border-color) tw:mb-3"></div>
          <div class="tw:mb-[0.875rem]">
            <div class="tw:flex tw:justify-between tw:items-baseline tw:text-[0.8125rem] tw:py-[0.125rem]">
              <span class="tw:text-(--o2-text-muted) tw:font-medium">{{ t('about.feature_license') }}</span>
              <span class="tw:text-(--o2-text-body) tw:font-semibold">{{ ed.license }}</span>
            </div>
            <div class="tw:flex tw:justify-between tw:items-baseline tw:text-[0.8125rem] tw:py-[0.125rem]">
              <span class="tw:text-(--o2-text-muted) tw:font-medium">{{ t('about.feature_support') }}</span>
              <span class="tw:text-(--o2-text-body) tw:font-semibold">{{ ed.support }}</span>
            </div>
          </div>
          <a
            v-if="ed.ctaUrl"
            :href="ed.ctaUrl"
            target="_blank"
            class="tw:block tw:w-full tw:py-2 tw:px-4 tw:rounded-md tw:text-sm tw:font-semibold tw:text-center tw:no-underline tw:cursor-pointer tw:transition-all tw:duration-200 tw:border-[1.5px] tw:border-solid tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_10%,var(--o2-card-bg))] tw:text-(--o2-primary-color) tw:border-[color-mix(in_srgb,var(--o2-primary-color)_30%,transparent)] tw:hover:bg-[color-mix(in_srgb,var(--o2-primary-color)_18%,var(--o2-card-bg))] tw:hover:border-(--o2-primary-color)"
          >
            {{ ed.ctaLabel }}
          </a>
          <button v-else class="tw:block tw:w-full tw:py-2 tw:px-4 tw:rounded-md tw:text-sm tw:font-semibold tw:text-center tw:no-underline tw:cursor-default tw:transition-all tw:duration-200 tw:border-[1.5px] tw:border-solid tw:bg-transparent tw:text-(--o2-text-muted) tw:border-(--o2-border-color)" disabled>
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
import { useI18n } from "vue-i18n";
import { FEATURE_REGISTRY, getFeatureNameKey, type FeatureDefinition } from "@/constants/features";

const store = useStore();
const { t } = useI18n();

const buildType: string = store.state.zoConfig.build_type;

// Feature IDs shown as pillar chips (not repeated in the list below)
const PILLAR_IDS = ['logs', 'metrics', 'traces', 'rum', 'alerts'];
const EXCLUDED_FROM_LIST = new Set([
  'logs', 'metrics', 'traces', 'rum', 'alerts',
  'dashboards',   // shown as extra chip
  'license',      // shown in footer
  'support',      // shown in footer
  'cost',         // not shown in card layout
]);

// Features rendered as check/X rows inside each edition card
const listFeatures = computed(() =>
  FEATURE_REGISTRY.filter((f) => !EXCLUDED_FROM_LIST.has(f.id))
);

// ── Edition metadata ──────────────────────────────────────────────────────────

interface EditionMeta {
  id: string;
  shortName: string;
  hosting: string;
  price: string;
  priceSub: string;
  license: string;
  support: string;
  ctaLabel: string;
  ctaUrl: string | null;
}

const editionList = computed((): EditionMeta[] => [
  {
    id: 'opensource',
    shortName: 'Open Source',
    hosting: 'Self-hosted',
    price: t('about.value_cost_free'),
    priceSub: 'Forever, no limits',
    license: t('about.value_license_agpl'),
    support: t('about.value_support_community'),
    ctaLabel: buildType === 'opensource' ? 'Current plan' : 'Learn more',
    ctaUrl: buildType === 'opensource' ? null : 'https://openobserve.ai',
  },
  {
    id: 'enterprise',
    shortName: 'Enterprise',
    hosting: 'Self-hosted',
    price: t('about.value_cost_free'),
    priceSub: 'Up to 50 GB/day · paid beyond',
    license: t('about.value_license_enterprise'),
    support: t('about.value_support_enterprise'),
    ctaLabel: buildType === 'enterprise' ? 'Current plan' : 'Download',
    ctaUrl: buildType === 'enterprise' ? null : 'https://openobserve.ai/download',
  },
  {
    id: 'cloud',
    shortName: 'Cloud',
    hosting: 'Fully managed',
    price: '14-day trial',
    priceSub: 'Usage-based thereafter',
    license: t('about.value_license_cloud'),
    support: t('about.value_support_cloud'),
    ctaLabel: buildType === 'cloud' ? 'Current plan' : 'Start free trial',
    ctaUrl: buildType === 'cloud' ? null : 'https://cloud.openobserve.ai',
  },
]);

// ── Feature availability helpers ─────────────────────────────────────────────

type FeatureStatus = 'available' | 'unavailable' | 'conditional';

function getFeatureStatus(feature: FeatureDefinition, editionId: string): FeatureStatus {
  const raw = feature.availability[editionId as keyof typeof feature.availability];
  if (raw === true) return 'available';
  if (raw === false) return 'unavailable';
  return 'conditional'; // string value = available with a condition
}

function getFeatureNote(feature: FeatureDefinition, editionId: string): string {
  const raw = feature.availability[editionId as keyof typeof feature.availability];
  if (typeof raw !== 'string') return '';
  // Translate the key and strip any leading emoji (e.g. "✅ ") so we show clean text
  return t(raw).replace(/^[✅❌]\s*/u, '').trim();
}
</script>

