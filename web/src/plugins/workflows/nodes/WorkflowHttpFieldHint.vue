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
  <div data-test="workflow-condition-http-body-hint" class="mt-2 flex flex-col gap-1">
    <OText variant="meta" as="p">{{ t("workflow.http.fieldGroupBodyHint") }}</OText>
    <OText variant="meta" as="p">{{ t("workflow.http.fieldGroupQueryHint") }}</OText>
  </div>
</template>

<script lang="ts" setup>
import { useI18nTyped } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";

const { t } = useI18nTyped();
</script>
