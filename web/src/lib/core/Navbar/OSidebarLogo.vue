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
/** Full OpenObserve wordmark, always expanded; lives in the header row so collapsing the sidebar never shrinks it. */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";

const store = useStore();
const { t } = useI18nTyped();
const { isDark } = useTheme();
const zo = computed(() => store.state.zoConfig ?? {});
const linkTo = computed(() => ({
  path: "/",
  query: { org_identifier: store.state.selectedOrganization?.identifier },
}));
// Same precedence as the classic header: theme-matched image, then either image, then text.
const customLogo = computed(() => {
  if (config.isEnterprise !== "true") return { text: "", img: "", isSet: false };
  const text: string = zo.value.custom_logo_text || "";
  const raw64: string | null =
    (isDark.value
      ? (zo.value.custom_logo_dark_img ?? zo.value.custom_logo_img)
      : (zo.value.custom_logo_img ?? zo.value.custom_logo_dark_img)) ?? null;
  const img = raw64 ? `data:image; base64, ${raw64}` : "";
  return { text, img, isSet: !!(text || img) };
});
const showSelfLogo = computed(
  () => !customLogo.value.isSet || zo.value.custom_hide_self_logo === false,
);
const selfLogoSrc = computed(() =>
  getImageURL(
    customLogo.value.isSet
      ? isDark.value
        ? "images/common/openobserve_mark_dark.svg"
        : "images/common/openobserve_mark_light.svg"
      : isDark.value
        ? "images/common/openobserve_latest_dark_2.svg"
        : "images/common/openobserve_latest_light_2.svg",
  ),
);
</script>

<template>
  <RouterLink
    :to="linkTo"
    class="inline-flex min-w-0 items-center gap-2 text-inherit no-underline"
    data-test="sidebar-logo"
    :aria-label="raw('OpenObserve')"
  >
    <span
      v-if="customLogo.text"
      class="truncate text-lg font-semibold"
      data-test="sidebar-custom-logo-text"
      >{{ customLogo.text }}</span
    >
    <img
      v-if="customLogo.img"
      class="block max-h-7 w-auto max-w-37.5 min-w-0 shrink object-contain"
      :src="customLogo.img"
      :alt="t('common.customLogoAlt')"
      data-test="sidebar-custom-logo"
    />
    <img
      v-if="showSelfLogo"
      class="block w-auto shrink-0"
      :class="customLogo.isSet ? 'h-5' : 'h-7'"
      :src="selfLogoSrc"
      alt=""
      data-test="sidebar-openobserve-logo"
    />
  </RouterLink>
</template>
