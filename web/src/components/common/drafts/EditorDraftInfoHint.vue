<!--
Copyright 2026 OpenObserve Inc.

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
  <OButton
    variant="ghost-muted"
    size="icon-xs-sq"
    icon-left="info-outline"
    class="shrink-0"
    :aria-label="content"
    :data-test="dataTest"
  >
    <OTooltip :content="content" side="top" />
  </OButton>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{
  content: I18nText;
  dataTest: string;
}>();
</script>
