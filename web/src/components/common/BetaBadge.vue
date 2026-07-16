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
  The "Beta" tag. One component so every beta surface (Workflows list / editor /
  runs, the AI assistant, …) looks identical — change the look here and it moves
  everywhere, instead of the badge being re-typed per header.
-->
<template>
  <OBadge
    variant="primary-outline"
    size="sm"
    class="uppercase tracking-wide font-semibold"
    data-test="beta-badge"
  >
    {{ t("common.beta") }}
  </OBadge>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";

const { t } = useI18n();
</script>
