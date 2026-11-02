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

<!-- Rendered in place of a page whose API exists only with online evaluations on. -->
<template>
  <OPageLayout
    :title="t('onlineEvals.disabled.title')"
    icon="toggle-off"
    constrained
    data-test="online-evals-disabled"
  >
    <OEmptyState
      size="hero"
      icon="toggle-off"
      :title="t('onlineEvals.disabled.title')"
      :description="t('onlineEvals.disabled.description')"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>
