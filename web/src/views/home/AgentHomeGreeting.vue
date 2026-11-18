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
  <div
    class="flex min-w-0 items-center justify-center pt-10 pb-2 max-md:pt-6"
    data-test="agent-home-greeting"
  >
    <div class="flex min-w-0 flex-col gap-1.5">
      <i18n-t
        v-if="displayName"
        :keypath="namedKey"
        tag="h2"
        :class="HEADING_CLASS"
        data-test="agent-home-greeting-text"
      >
        <template #name>
          <span data-test="agent-home-greeting-name">{{ displayName }}</span>
        </template>
      </i18n-t>
      <h2 v-else :class="HEADING_CLASS" data-test="agent-home-greeting-text">
        {{ investigate ? t("autobotInvestigate.greeting") : greeting }}
      </h2>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import { useGreeting } from "@/components/ai-assistant/welcome/useGreeting";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

const props = defineProps<{
  /** The investigate page asks what to look into instead of greeting by time of day. */
  investigate?: boolean;
}>();

const HEADING_CLASS = "text-text-heading text-3xl leading-tight font-semibold max-md:text-2xl";

const { t } = useI18nTyped();
const vuex = useStore();
const { greeting, displayName, period } = useGreeting(() => vuex?.state.userInfo?.email);
// The name sits in the translated sentence as a slot, so the language still decides where it goes.
const namedKey = computed<I18nKey>(() =>
  props.investigate
    ? "autobotInvestigate.greetingNamed"
    : `aiAssistant.greetingNamed.${period.value}`,
);
</script>
