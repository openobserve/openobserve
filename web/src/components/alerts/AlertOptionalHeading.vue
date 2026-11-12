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

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="border-border-default mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t pt-3 pb-1"
    data-test="add-alert-optional-heading"
  >
    <span class="text-text-heading text-sm font-medium">{{
      t("alerts.sections.optional.title")
    }}</span>
    <span class="text-text-secondary text-xs">{{ t("alerts.sections.optional.help") }}</span>
  </div>
</template>
