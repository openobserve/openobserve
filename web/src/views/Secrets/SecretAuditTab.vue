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

<!-- The store has no per-secret audit read route in P1; events land in the org audit trail. -->
<template>
  <div class="flex flex-col gap-2" data-test="secret-audit-tab">
    <span class="text-text-body text-sm">{{ t("secrets.audit.where") }}</span>
    <span class="text-text-secondary text-xs">{{ t("secrets.audit.noValues") }}</span>
    <code class="bg-surface-subtle text-compact rounded-default w-fit px-2 py-1 font-mono">{{
      filterText
    }}</code>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SecretDetail } from "@/services/secrets";

const props = defineProps<{ detail: SecretDetail }>();
const { t } = useI18nTyped();

const filterText = computed(() => raw(`path LIKE '%/secrets/${props.detail.id}%'`));
</script>
