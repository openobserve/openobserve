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
  <!-- only an edition gap can be upgraded from here; a license lock just states its reason -->
  <OEmptyState
    v-if="clickable"
    size="compact"
    icon="lock"
    :title="message"
    :action-label="t('about.learnMore')"
    data-test="overview-locked-note"
    @action="emit('open')"
  />
  <OEmptyState
    v-else
    size="compact"
    icon="lock"
    :title="message"
    data-test="overview-locked-note"
  />
</template>

<script setup lang="ts">
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{ message: I18nText; clickable: boolean }>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();
</script>
