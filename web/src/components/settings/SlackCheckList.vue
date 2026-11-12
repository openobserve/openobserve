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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { SlackCheckStatus } from "@/types/slack";
import { checkIcon, checkIconClass } from "./slackCheckStatus";

export interface SlackCheckItem {
  key: string;
  label: I18nText;
  status: SlackCheckStatus;
  detail: string;
}

defineProps<{ items: SlackCheckItem[] }>();

const { t } = useI18nTyped();
</script>

<template>
  <ul class="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 md:grid-cols-2">
    <li
      v-for="item in items"
      :key="item.key"
      class="flex items-start gap-2 text-sm"
      :data-status="item.status"
      :data-test="`slack-check-${item.key}`"
    >
      <OIcon
        :name="checkIcon(item.status)"
        size="sm"
        class="mt-0.5 shrink-0"
        :class="checkIconClass(item.status)"
        :label="t(`slackApp.status.${item.status}`)"
      />
      <span class="flex min-w-0 flex-col">
        <span class="text-text-heading font-medium">{{ item.label }}</span>
        <span class="text-text-secondary break-words">{{ raw(item.detail) }}</span>
      </span>
    </li>
  </ul>
</template>
