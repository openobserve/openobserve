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

<!--
  The feature-grid half of the enterprise offer — shared between
  `EnterpriseUpgradeDialog` (the modal's right panel) and the full-page
  `EnterpriseFeatures` view a locked nav item now routes to, so the two never
  drift into two different feature catalogs.
-->
<template>
  <div
    class="bg-surface-base flex flex-1 flex-col overflow-hidden"
    :class="[{ 'max-w-full': isCloudLayout }]"
  >
    <div
      class="bg-surface-base border-border-default sticky top-0 z-10 border-b px-8 pt-4 pb-3 text-center"
    >
      <div
        data-test="enterprise-upgrade-features-title"
        class="text-text-heading mb-1 text-lg font-bold [letter-spacing:-0.01875rem]"
      >
        {{ featuresTitle }}
      </div>
      <div class="text-text-secondary text-xs font-medium">
        {{ featuresSubtitle }}
      </div>
    </div>

    <!-- Cloud 3-column layout -->
    <div
      v-if="isCloudLayout"
      data-test="enterprise-upgrade-features-list-cloud"
      class="grid flex-1 grid-cols-3 content-start gap-x-[0.875rem] gap-y-[0.4375rem] overflow-y-auto px-8 pt-2 pb-4"
    >
      <!-- Column 1: Core Features -->
      <div
        v-for="feature in coreFeatures"
        :key="feature.name"
        data-test="enterprise-upgrade-feature-item"
        class="rounded-default flex gap-2.5 border p-[0.5rem_0.75rem] transition-all duration-200"
        :class="[
          'border-border-default',
          feature.link
            ? isDark
              ? 'hover:border-theme-accent/40 hover:bg-theme-accent/10 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
              : 'hover:border-theme-accent/30 hover:bg-theme-accent/5 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
            : isDark
              ? 'hover:bg-[rgba(255,255,255,0.05)]'
              : 'hover:border-[rgba(0,0,0,0.12)] hover:bg-[rgba(0,0,0,0.03)]',
        ]"
        @click="feature.link && openFeatureLink(feature.link)"
      >
        <div
          class="rounded-default bg-theme-accent/10 text-theme-accent dark:bg-theme-accent/15 flex h-7.5 w-7.5 shrink-0 items-center justify-center"
        >
          <OIcon :name="feature.icon" size="sm" />
        </div>
        <div class="min-w-0 flex-1">
          <div
            class="text-compact mb-0.5 flex items-center gap-1.5 leading-[1.25] font-semibold"
            :class="'text-text-heading'"
          >
            {{ feature.name }}
            <OIcon
              v-if="feature.link"
              name="open-in-new"
              size="xs"
              class="ms-1 align-middle opacity-60"
            />
          </div>
          <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">
            {{ feature.note }}
          </div>
        </div>
      </div>

      <!-- Columns 2 & 3: Enterprise Features -->
      <div
        v-for="feature in enterpriseFeatures"
        v-show="!feature.cloudHidden"
        :key="feature.name"
        data-test="enterprise-upgrade-feature-item"
        class="rounded-default flex gap-2.5 border p-[0.5rem_0.75rem] transition-all duration-200"
        :class="[
          'border-border-default',
          feature.link
            ? isDark
              ? 'hover:border-theme-accent/40 hover:bg-theme-accent/10 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
              : 'hover:border-theme-accent/30 hover:bg-theme-accent/5 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
            : isDark
              ? 'hover:bg-[rgba(255,255,255,0.05)]'
              : 'hover:border-[rgba(0,0,0,0.12)] hover:bg-[rgba(0,0,0,0.03)]',
        ]"
        @click="feature.link && openFeatureLink(feature.link)"
      >
        <div
          class="rounded-default bg-theme-accent/10 text-theme-accent dark:bg-theme-accent/15 flex h-7.5 w-7.5 shrink-0 items-center justify-center"
        >
          <OIcon :name="feature.icon" size="sm" />
        </div>
        <div class="min-w-0 flex-1">
          <div
            class="text-compact mb-0.5 flex items-center gap-1.5 leading-[1.25] font-semibold"
            :class="'text-text-heading'"
          >
            {{ feature.name }}
            <OIcon
              v-if="feature.link"
              name="open-in-new"
              size="xs"
              class="ms-1 align-middle opacity-60"
            />
            <OTag
              v-if="feature.beta"
              type="featureFlag"
              value="beta"
              data-test="enterprise-upgrade-feature-beta-badge"
            />
          </div>
          <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">
            {{ feature.note }}
          </div>
        </div>
      </div>
    </div>

    <!-- Standard 2-column layout for non-Cloud -->
    <div
      v-else
      data-test="enterprise-upgrade-features-list-standard"
      class="grid flex-1 grid-cols-2 content-start gap-x-[0.875rem] gap-y-[0.4375rem] overflow-y-auto px-8 pt-2 pb-4"
    >
      <div
        v-for="feature in enterpriseFeatures"
        v-show="!feature.cloudOnly"
        :key="feature.name"
        data-test="enterprise-upgrade-feature-item"
        class="rounded-default flex gap-2.5 border p-[0.5rem_0.75rem] transition-all duration-200"
        :class="[
          'border-border-default',
          feature.link
            ? isDark
              ? 'hover:border-theme-accent/40 hover:bg-theme-accent/10 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
              : 'hover:border-theme-accent/30 hover:bg-theme-accent/5 cursor-pointer hover:[transform:translateX(0.125rem)] active:[transform:translateX(0)]'
            : isDark
              ? 'hover:bg-[rgba(255,255,255,0.05)]'
              : 'hover:border-[rgba(0,0,0,0.12)] hover:bg-[rgba(0,0,0,0.03)]',
        ]"
        @click="feature.link && openFeatureLink(feature.link)"
      >
        <div
          class="rounded-default bg-theme-accent/10 text-theme-accent dark:bg-theme-accent/15 flex h-7.5 w-7.5 shrink-0 items-center justify-center"
        >
          <OIcon :name="feature.icon" size="sm" />
        </div>
        <div class="min-w-0 flex-1">
          <div
            data-test="enterprise-upgrade-feature-name"
            class="text-compact mb-0.5 flex items-center gap-1.5 leading-[1.25] font-semibold"
            :class="'text-text-heading'"
          >
            {{ feature.name }}
            <OIcon
              v-if="feature.link"
              name="open-in-new"
              size="xs"
              data-test="enterprise-upgrade-feature-external-link"
              class="ms-1 align-middle opacity-60"
            />
            <OTag
              v-if="feature.beta"
              type="featureFlag"
              value="beta"
              data-test="enterprise-upgrade-feature-beta-badge"
            />
            <span v-if="feature.requiresHA" class="inline-flex">
              <OTag type="featureFlag" value="ha" data-test="enterprise-upgrade-feature-ha-badge" />
              <OTooltip
                side="top"
                align="center"
                :sideOffset="8"
                :content="t('about.enterprise_offer.tooltip.high_availability_mode_only')"
              />
            </span>
          </div>
          <div class="text-2xs leading-[1.25]" :class="'text-text-secondary'">
            {{ feature.note }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

interface OfferFeature {
  name: string;
  note: string;
  icon: string;
  link?: string;
  requiresHA?: boolean;
  beta?: boolean;
  cloudOnly?: boolean;
  cloudHidden?: boolean;
}

defineProps<{
  isCloudLayout?: boolean;
  featuresTitle: I18nText;
  featuresSubtitle: I18nText;
  coreFeatures: OfferFeature[];
  enterpriseFeatures: OfferFeature[];
  isDark: boolean;
}>();

const { t } = useI18nTyped();

const openFeatureLink = (url: string) => {
  window.open(url, "_blank");
};
</script>
