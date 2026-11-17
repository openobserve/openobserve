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
import OIcon from "../Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";
import { DATA_AGE_MARKER_CLASS } from "./dataAgeMarker";

const { t } = useI18nTyped();
</script>

<template>
  <span
    aria-hidden="true"
    class="invisible"
    :class="DATA_AGE_MARKER_CLASS"
    data-test="data-age-failed-reserve"
  >
    <OIcon name="error-outline" size="xs" />
    <span>{{ t("dataAge.refreshFailedShort") }}</span>
  </span>
</template>
