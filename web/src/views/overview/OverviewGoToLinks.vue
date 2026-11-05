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
  <nav
    v-if="links.length"
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-1"
    data-test="overview-go-to-links"
  >
    <div class="flex min-h-7 items-center gap-2 ps-1.5">
      <h3 :id="headingId" class="text-text-secondary min-w-0 flex-1 text-xs">
        {{ t("overview.goTo.heading") }}
      </h3>
      <OShortcut id="goTo" class="shrink-0" />
    </div>
    <ul class="grid grid-cols-2 gap-x-2">
      <li v-for="page in links" :key="page.id" class="min-w-0">
        <OButton
          variant="ghost"
          size="sm"
          block
          class="justify-start! px-1.5! font-normal"
          :data-test="`overview-go-to-${page.id}`"
          @click="emit('open', page)"
        >
          <OTruncatedText class="text-text-heading min-w-0">{{ page.label }}</OTruncatedText>
        </OButton>
      </li>
    </ul>
    <OText variant="meta" as="p" class="ps-1.5">{{ t("overview.goTo.hint") }}</OText>
  </nav>
</template>

<script setup lang="ts">
import { computed, inject, useId } from "vue";

import { GO_TO_PAGES, type GoToPage } from "@/composables/goto/types";
import OButton from "@/lib/core/Button/OButton.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped } from "@/types/i18n";

// The six destinations the board names, in its order; a page the menu hides is left out.
const OVERVIEW_GO_TO_IDS = [
  "logs",
  "metrics",
  "traces",
  "dashboards",
  "alertList",
  "incidentList",
] as const;

const emit = defineEmits<{ open: [page: GoToPage] }>();

const { t } = useI18nTyped();
const headingId = `overview-go-to-${useId()}`;
const pages = inject(GO_TO_PAGES, null);

const links = computed(() => {
  const all = pages?.value ?? [];
  return OVERVIEW_GO_TO_IDS.flatMap((id) => all.filter((page) => page.id === id));
});
</script>
