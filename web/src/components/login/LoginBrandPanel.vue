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
  <aside
    class="bg-surface-panel border-border-default flex h-full min-h-0 flex-col justify-between gap-10 overflow-y-auto border-e px-14 py-12"
    data-test="login-brand-panel"
  >
    <a href="https://openobserve.ai/" target="_blank" rel="noopener noreferrer" class="w-fit">
      <img
        class="h-9 w-auto"
        :alt="t('login.openObserveLogoAlt')"
        :src="
          isDark
            ? getImageURL('images/common/openobserve_latest_dark_2.svg')
            : getImageURL('images/common/openobserve_latest_light_2.svg')
        "
      />
    </a>

    <div class="flex max-w-120 flex-col gap-10">
      <div class="flex flex-col gap-3">
        <h2 class="text-text-heading text-3xl leading-tight font-semibold">
          {{ t("login.brand.headline") }}
        </h2>
        <p class="text-text-secondary text-base">{{ t("login.brand.tagline") }}</p>
      </div>

      <ul class="flex flex-col gap-6">
        <li
          v-for="feature in features"
          :key="feature.icon"
          class="flex items-start gap-4"
          :data-test="`login-brand-feature-${feature.icon}`"
        >
          <span
            class="bg-selected-bg text-selected-fg rounded-default flex size-9 shrink-0 items-center justify-center"
          >
            <OIcon :name="feature.icon" size="md" />
          </span>
          <div class="flex flex-col gap-0.5">
            <span class="text-text-heading text-sm font-semibold">{{ feature.title }}</span>
            <span class="text-text-secondary text-sm">{{ feature.body }}</span>
          </div>
        </li>
      </ul>
    </div>

    <a
      href="https://openobserve.ai/"
      target="_blank"
      rel="noopener noreferrer"
      class="text-text-secondary hover:text-text-heading w-fit text-sm"
      data-test="login-brand-site-link"
    >
      {{ t("login.brand.learnMore", { site: raw("openobserve.ai") }) }}
    </a>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "@/utils/zincutils";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

interface BrandFeature {
  icon: IconName;
  title: I18nText;
  body: I18nText;
}

const { t } = useI18nTyped();
const { isDark } = useTheme();

const features = computed<BrandFeature[]>(() => [
  {
    icon: "layers",
    title: t("login.brand.unifiedTitle"),
    body: t("login.brand.unifiedBody"),
  },
  {
    icon: "database",
    title: t("login.brand.storageTitle", { factor: raw("140×") }),
    body: t("login.brand.storageBody", { product: raw("Elasticsearch") }),
  },
  {
    icon: "hub",
    title: t("login.brand.otelTitle", { standard: raw("OpenTelemetry") }),
    body: t("login.brand.otelBody"),
  },
  {
    icon: "code",
    title: t("login.brand.openTitle"),
    body: t("login.brand.openBody"),
  },
]);
</script>
