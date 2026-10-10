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
  "Manage as code" — where the Terraform and OpenTofu provider lives.

  This sits in Data Sources rather than beside every alert, SLO, dashboard and
  pipeline list, because "where do I get the provider" is a one-time question
  and Data Sources is already where someone goes to connect OpenObserve to
  another tool. The lists keep the export itself; this keeps the pointer.
-->
<script setup lang="ts">
// Used as a router-view target in Recommended.vue, which passes unrelated props
// (title / currOrgIdentifier / currUserEmail) — don't let them leak onto the root.
defineOptions({ inheritAttrs: false });

import OIcon from "@/lib/core/Icon/OIcon.vue";
import IacRegistryLinks from "@/components/common/IacRegistryLinks.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

/** What can be exported today, so the page answers "does it cover X?". */
const RESOURCES = [
  "ingestion.iac.resourceAlerts",
  "ingestion.iac.resourceSlos",
  "ingestion.iac.resourceDashboards",
  "ingestion.iac.resourcePipelines",
] as const;
</script>

<template>
  <div class="p-2" data-test="iac-cross-link">
    <div
      class="rounded-surface border-border-default bg-surface-panel flex max-w-3xl flex-col items-start gap-3 border p-6"
    >
      <div class="flex items-center gap-2">
        <OIcon name="code" size="md" />
        <h2 class="text-lg font-semibold">
          {{ t("ingestion.iac.title", { brand: raw("OpenObserve") }) }}
        </h2>
      </div>

      <p class="text-text-secondary text-sm">
        {{ t("ingestion.iac.body", { brand: raw("OpenObserve") }) }}
      </p>

      <ul class="text-text-secondary flex flex-col gap-1 text-sm">
        <li v-for="key in RESOURCES" :key="key" class="flex items-center gap-2">
          <OIcon name="check-circle-outline" size="xs" class="text-success" />
          {{ t(key) }}
        </li>
      </ul>

      <!-- The two marks, each linking to the provider on that registry. -->
      <div class="flex items-center gap-3 pt-1">
        <span class="text-text-tertiary text-xs font-semibold">
          {{ t("ingestion.iac.registriesLabel") }}
        </span>
        <IacRegistryLinks data-test="iac-cross-link-registries" />
      </div>
    </div>
  </div>
</template>
