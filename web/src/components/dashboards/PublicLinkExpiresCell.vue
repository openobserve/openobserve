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
  <span v-if="!link.expires_at" class="text-text-secondary text-sm">
    {{ t("dashboard.publicLinks.never") }}
  </span>
  <span
    v-else-if="note"
    class="text-sm"
    :class="note.soon ? 'text-status-warning-text' : 'text-text-body'"
  >
    {{ note.text }}
  </span>
  <OTimeCell v-else :value="link.expires_at" unit="us" mode="date" :timezone="timezone" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { PublicLink } from "@/services/public_dashboards_admin";
import { publicLinkExpiry } from "./publicLinkDisplay";

const props = defineProps<{ link: PublicLink; timezone: string }>();

const { t } = useI18nTyped();
const note = computed(() => publicLinkExpiry(props.link, props.timezone, t));
</script>
