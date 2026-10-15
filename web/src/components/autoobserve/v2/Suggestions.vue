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
  <SectionCard
    v-if="requests.length"
    :title="t('autoobserve2.suggestions.title')"
    :count="pending || undefined"
    data-test="autoobserve2-suggestions"
  >
    <p class="text-text-secondary -mt-2 px-5 pb-3 text-sm leading-relaxed text-pretty sm:px-6">
      {{ t("autoobserve2.suggestions.subtitle") }}
    </p>
    <ul class="flex flex-col gap-2.5 px-3 pb-3 sm:px-4">
      <li v-for="request in requests" :key="request.id">
        <AskCard :request="request" />
      </li>
    </ul>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import SectionCard from "./SectionCard.vue";
import AskCard from "./AskCard.vue";
import { useDecisions } from "./useDecisions";
import type { Request } from "./fixtures";

const props = defineProps<{ requests: Request[] }>();

const { t } = useI18nTyped();

const { decisions } = useDecisions();

const pending = computed(() => props.requests.filter((r) => !decisions[r.id]).length);
</script>
