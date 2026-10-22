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
  <span
    class="flex shrink-0 items-center"
    :class="size === 'md' ? 'text-text-body gap-2 text-sm' : 'text-text-secondary gap-1.5'"
    data-test="powered-by-openobserve"
  >
    <span>{{ t("common.poweredBy") }}</span>
    <a
      href="https://openobserve.ai/"
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-1.5 hover:underline focus-visible:underline"
      data-test="powered-by-openobserve-link"
    >
      <img
        class="block"
        :class="size === 'md' ? 'h-8 max-w-37.5' : 'h-6 max-w-28'"
        :src="
          getImageURL(
            isDark
              ? 'images/common/openobserve_latest_dark_2.svg'
              : 'images/common/openobserve_latest_light_2.svg',
          )
        "
        :alt="brand"
      />
    </a>
  </span>
</template>

<script setup lang="ts">
import { useI18nTyped, raw } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "@/utils/queryUtils";

withDefaults(defineProps<{ size?: "sm" | "md" }>(), { size: "sm" });

const { t } = useI18nTyped();
const brand = raw("OpenObserve");
const { isDark } = useTheme();
</script>
