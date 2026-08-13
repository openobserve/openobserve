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

<!--
  Dedicated Notification Dependencies page — a thin OPageLayout shell around the
  reusable AlertDependenciesGraph (which owns the toolbar, canvas and logic; the
  same component powers the on-the-fly popup on the list pages).
-->
<template>
  <div class="flex h-full flex-col p-0">
    <OPageLayout
      bleed
      :title="t('alert_dependencies.header')"
      title-data-test="alert-dependencies-title"
      icon="account-tree"
      :subtitle="t('alert_dependencies.subtitle')"
    >
      <AlertDependenciesGraph />
    </OPageLayout>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import AlertDependenciesGraph from "./AlertDependenciesGraph.vue";

const { t } = useI18nTyped();
</script>
