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

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{
  service: string;
  where: I18nText | null;
  routes: { home: RouteLocationRaw; service: RouteLocationRaw };
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div class="flex flex-col gap-2" data-test="synthetics-prefill-banner">
    <nav
      :aria-label="t('synthetics.prefill.breadcrumbLabel')"
      class="text-text-secondary flex flex-wrap items-center gap-1 text-xs"
      data-test="synthetics-prefill-breadcrumb"
    >
      <router-link
        :to="routes.home"
        class="text-text-link hover:underline"
        data-test="synthetics-prefill-breadcrumb-home"
        >{{ t("synthetics.prefill.breadcrumbRoot") }}</router-link
      >
      <OIcon name="chevron-right" size="xs" />
      <router-link
        :to="routes.service"
        class="text-text-link hover:underline"
        data-test="synthetics-prefill-breadcrumb-service"
        >{{ service }}</router-link
      >
      <OIcon name="chevron-right" size="xs" />
      <span aria-current="page">{{ t("synthetics.prefill.breadcrumbPage") }}</span>
    </nav>
    <OBanner variant="info" data-test="synthetics-prefill-banner-text">
      <i18n-t
        :keypath="where ? 'synthetics.prefill.banner' : 'synthetics.prefill.bannerNoWhere'"
        tag="span"
        scope="global"
      >
        <template #lead>
          <strong>{{ t("synthetics.prefill.bannerLead", { service }) }}</strong>
        </template>
        <template #where>{{ where }}</template>
        <template #service>{{ service }}</template>
        <template #save>{{ t("synthetics.newCheck.saveAndExit") }}</template>
      </i18n-t>
    </OBanner>
  </div>
</template>
