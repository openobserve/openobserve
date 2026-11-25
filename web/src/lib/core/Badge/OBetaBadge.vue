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
import type { BetaBadgeProps } from "./OBetaBadge.types";

withDefaults(defineProps<BetaBadgeProps>(), { stage: "beta" });

const { t } = useI18nTyped();
</script>

<template>
  <!-- Fixed height, leading-none and reset casing/italics keep it identical inside any host line. -->
  <span
    class="bg-accent/12 text-selected-fg text-2xs inline-flex h-4 shrink-0 items-center rounded-full px-1.5 leading-none font-medium whitespace-nowrap normal-case not-italic"
    :data-test="`${stage}-badge`"
  >
    {{ stage === "alpha" ? t("common.alpha") : t("common.beta") }}
  </span>
</template>
