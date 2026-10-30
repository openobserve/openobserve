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
  <div class="flex flex-col gap-1 text-sm" data-test="rum-analytics-exclusions-builtin">
    <span v-if="builtin" class="text-text-body">{{
      t("rum.analytics.exclusions.builtinNames", {
        families: raw(builtin.families.join(", ")),
        devices: raw(builtin.devices.join(", ")),
      })
    }}</span>
    <span
      v-if="removed !== null"
      class="text-text-secondary"
      data-test="rum-analytics-exclusions-builtin-removed"
      >{{
        t("rum.analytics.exclusions.builtinRemoved", { count: addCommasToNumber(removed) }, removed)
      }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import type { BuiltinBots } from "@/utils/rum/productAnalyticsModel";

// The list comes from the server's response, never a copy kept in web code.
defineProps<{ builtin?: BuiltinBots; removed: number | null }>();
const { t } = useI18nTyped();
</script>
