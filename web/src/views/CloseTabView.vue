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
  <main
    class="bg-surface-base flex min-h-screen items-center justify-center p-4"
    data-test="close-tab"
  >
    <OEmptyState
      size="block"
      icon="check-circle"
      :title="t('assistant.closeTab.title')"
      :description="t('assistant.closeTab.body')"
      data-test="close-tab-message"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

// Browsers allow this only for a tab a script opened, which the Sign in action did; otherwise the text says what to do.
onMounted(() => window.close());
</script>
