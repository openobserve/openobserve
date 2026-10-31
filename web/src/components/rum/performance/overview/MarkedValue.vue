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
  <span>
    <span v-if="band === 'needs' || band === 'poor'" aria-hidden="true">{{ GLYPH[band] }} </span>
    {{ text }}
    <span v-if="band === 'needs'" class="sr-only">{{ t("rum.overviewPage.markNeeds") }}</span>
    <span v-else-if="band === 'poor'" class="sr-only">{{ t("rum.overviewPage.markPoor") }}</span>
  </span>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { Band } from "@/utils/rum/performanceOverview";

defineProps<{ band: Band | null; text: I18nText }>();
const { t } = useI18nTyped();
const GLYPH = { needs: "\u25B2", poor: "\u25A0" } as const;
</script>
