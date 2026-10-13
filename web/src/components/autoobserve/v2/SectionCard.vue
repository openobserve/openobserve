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
  <section
    class="bg-surface-base border-border-subtle rounded-surface overflow-hidden border shadow-xs"
  >
    <header class="flex min-h-14 flex-wrap items-center gap-3 px-5 pt-4 pb-3 sm:px-6">
      <slot name="title">
        <h2 class="text-text-heading text-base font-semibold whitespace-nowrap">{{ title }}</h2>
      </slot>
      <span
        v-if="count !== undefined"
        class="bg-surface-subtle text-text-body rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
      >
        {{ count }}
      </span>
      <div class="ms-auto flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
    <footer v-if="$slots.footer" class="border-border-subtle border-t px-3 py-2 sm:px-4">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{
  title?: I18nText;
  count?: number;
}>();
</script>
