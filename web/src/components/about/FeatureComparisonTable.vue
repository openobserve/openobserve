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
  <div class="edition-comparison">

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="tw:flex tw:items-start tw:gap-3 tw:mb-2">
      <div class="ec-icon-wrapper">
        <OIcon name="compare-arrows" size="md" />
      </div>
      <div>
        <p class="header-eyebrow">EDITIONS</p>
        <h3 class="header-title">{{ t("about.feature_comparison_lbl") }}</h3>
      </div>
    </div>
    <p class="header-desc tw:mb-8">
      <template v-if="buildType === 'opensource'">{{ t("about.feature_comparision_os_msg") }}</template>
      <template v-else-if="buildType === 'enterprise'">{{ t("about.feature_comparision_ent_msg") }}</template>
      <template v-else>{{ t("about.feature_comparision_subtitle") }}</template>
    </p>

    <!-- ── Edition Cards Grid ──────────────────────────────────────────── -->
    <div class="tw:grid tw:grid-cols-3 tw:gap-5 tw:pt-4">
      <div
        v-for="ed in editionList"
        :key="ed.id"
        class="edition-card"
        :class="{ 'edition-card--active': buildType === ed.id }"
      >
        <!-- Your Plan badge (floats above the card top border) -->
        <div v-if="buildType === ed.id" class="your-plan-badge">
          <OIcon name="arrow-upward" size="sm" class="tw:mr-1" />
          Your Plan
        </div>

        <!-- Edition name + hosting + price ────────────────────────────── -->
        <div class="edition-card__top">
          <p class="edition-name">{{ ed.shortName }}</p>
          <p class="edition-hosting">{{ ed.hosting }}</p>
          <p class="edition-price">{{ ed.price }}</p>
          <p class="edition-price-sub">{{ ed.priceSub }}</p>
        </div>

        <!-- All Five Pillars chips ────────────────────────────────────── -->
        <div class="pillars-section">
          <p class="pillars-label">ALL FIVE PILLARS</p>
          <div class="tw:flex tw:flex-wrap tw:gap-1.5 tw:mb-1.5">
            <span v-for="pillarId in PILLAR_IDS" :key="pillarId" class="pillar-chip">
              {{ t(`about.feature_${pillarId}`) }}
            </span>
          </div>
          <span class="pillar-chip">{{ t('about.feature_dashboards') }}</span>
        </div>

        <!-- Feature list ───────────────────────────────────────────────── -->
        <ul class="feature-list">
          <li
            v-for="feature in listFeatures"
            :key="feature.id"
            class="feature-item"
            :class="`feature-item--${getFeatureStatus(feature, ed.id)}`"
          >
            <span class="feature-item__icon">
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
            <span class="feature-item__body">
              <span class="feature-item__name">{{ t(getFeatureNameKey(feature)) }}</span>
              <span v-if="getFeatureNote(feature, ed.id)" class="feature-item__note">
                {{ getFeatureNote(feature, ed.id) }}
              </span>
            </span>
          </li>
        </ul>

        <!-- Footer: license + support + CTA ──────────────────────────── -->
        <div class="edition-card__footer">
          <div class="footer-divider"></div>
          <div class="footer-meta">
            <div class="footer-row">
              <span class="footer-key">{{ t('about.feature_license') }}</span>
              <span class="footer-val">{{ ed.license }}</span>
            </div>
            <div class="footer-row">
              <span class="footer-key">{{ t('about.feature_support') }}</span>
              <span class="footer-val">{{ ed.support }}</span>
            </div>
          </div>
          <a
            v-if="ed.ctaUrl"
            :href="ed.ctaUrl"
            target="_blank"
            class="cta-btn cta-btn--action"
          >
            {{ ed.ctaLabel }}
          </a>
          <button v-else class="cta-btn cta-btn--current" disabled>
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

<style lang="scss" scoped>
.edition-comparison {

  // ─── Header ──────────────────────────────────────────────────────────────
  .ec-icon-wrapper {
    width: 48px;
    height: 48px;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--o2-primary-color) 12%, var(--o2-card-bg));
    color: var(--o2-primary-color);
  }

  .header-eyebrow {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--o2-primary-color);
    margin: 0 0 0.125rem;
  }

  .header-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-heading);
    margin: 0;
    letter-spacing: -0.015em;
  }

  .header-desc {
    font-size: var(--text-sm);
    line-height: 1.65;
    color: var(--o2-text-secondary);
    margin: 0.5rem 0 0;
  }

  // ─── Edition Cards ───────────────────────────────────────────────────────
  .edition-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--o2-card-bg);
    border-radius: 0.75rem;
    padding: 1.5rem;
    border: 1px solid var(--o2-border-color);

    &--active {
      border: 2px solid var(--o2-primary-color);
      padding-top: 1.75rem;
    }
  }

  // ── "Your Plan" badge ─────────────────────────────────────────────────────
  .your-plan-badge {
    position: absolute;
    top: -14px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.875rem;
    border-radius: 999px;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    background: var(--o2-primary-color);
    color: var(--o2-primary-foreground);
  }

  // ── Card top ─────────────────────────────────────────────────────────────
  .edition-card__top {
    margin-bottom: 1.25rem;
  }

  .edition-name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--o2-text-heading);
    margin: 0 0 0.125rem;
  }

  .edition-hosting {
    font-size: 0.8125rem;
    color: var(--o2-text-muted);
    margin: 0 0 0.875rem;
  }

  .edition-price {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--o2-primary-color);
    margin: 0 0 0.25rem;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .edition-price-sub {
    font-size: 0.8125rem;
    color: var(--o2-text-muted);
    margin: 0;
    line-height: 1.4;
  }

  // ── Pillars section ───────────────────────────────────────────────────────
  .pillars-section {
    background: color-mix(in srgb, var(--o2-primary-color) 5%, var(--o2-card-bg));
    border: 1px solid color-mix(in srgb, var(--o2-primary-color) 15%, transparent);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  .pillars-label {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--o2-text-label);
    margin: 0 0 0.5rem;
  }

  .pillar-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.1875rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 500;
    background: color-mix(in srgb, var(--o2-primary-color) 10%, var(--o2-card-bg));
    color: var(--o2-primary-color);
    border: 1px solid color-mix(in srgb, var(--o2-primary-color) 20%, transparent);
    margin-right: 0.375rem;
    margin-bottom: 0.375rem;
  }

  // ── Feature list ─────────────────────────────────────────────────────────
  .feature-list {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
  }

  .feature-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.4375rem 0;
    font-size: 0.8125rem;
    border-bottom: 1px solid var(--o2-border-color);

    &:last-child { border-bottom: none; }

    &__icon {
      flex-shrink: 0;
      margin-top: 0.125rem;
      line-height: 1;
    }

    &__body {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
    }

    &__name {
      line-height: 1.45;
    }

    &__note {
      font-size: 0.6875rem;
      color: var(--o2-text-muted);
      font-style: italic;
    }

    // Available: green icon + normal text
    &--available {
      color: var(--o2-text-body);

      .feature-item__icon { color: var(--o2-positive); }
    }

    // Conditional (string availability, e.g. "Requires HA mode"): green icon + muted note
    &--conditional {
      color: var(--o2-text-body);

      .feature-item__icon { color: var(--o2-positive); }
    }

    // Unavailable: gray icon + muted text
    &--unavailable {
      color: var(--o2-text-muted);

      .feature-item__icon { color: var(--o2-text-muted); }
    }
  }

  // ── Card footer ───────────────────────────────────────────────────────────
  .edition-card__footer {
    margin-top: 1rem;
  }

  .footer-divider {
    height: 1px;
    background: var(--o2-border-color);
    margin-bottom: 0.75rem;
  }

  .footer-meta {
    margin-bottom: 0.875rem;
  }

  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.8125rem;
    padding: 0.125rem 0;
  }

  .footer-key {
    color: var(--o2-text-muted);
    font-weight: 500;
  }

  .footer-val {
    color: var(--o2-text-body);
    font-weight: 600;
  }

  .cta-btn {
    display: block;
    width: 100%;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1.5px solid;

    // Non-current plan: interactive link style
    &--action {
      background: color-mix(in srgb, var(--o2-primary-color) 10%, var(--o2-card-bg));
      color: var(--o2-primary-color);
      border-color: color-mix(in srgb, var(--o2-primary-color) 30%, transparent);

      &:hover {
        background: color-mix(in srgb, var(--o2-primary-color) 18%, var(--o2-card-bg));
        border-color: var(--o2-primary-color);
      }
    }

    // Current plan: muted/disabled
    &--current {
      background: transparent;
      color: var(--o2-text-muted);
      border-color: var(--o2-border-color);
      cursor: default;
    }
  }

  // ─── Responsive ──────────────────────────────────────────────────────────
  // Cards always stay side-by-side; just reduce padding on tighter viewports
  @media (max-width: 1024px) {
    .edition-card {
      padding: 1rem;

      &--active { padding-top: 1.25rem; }
    }

    .edition-price {
      font-size: 1.375rem;
    }
  }
}
</style>
