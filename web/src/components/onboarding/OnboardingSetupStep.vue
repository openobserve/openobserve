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

<!-- One numbered step of an onboarding page, drawn like the lib stepper's vertical rail. The
     stepper renders a step that cannot be clicked as two disabled buttons; here the title is a
     heading, so a screen reader reads each step once. -->
<template>
  <li class="group/steps flex min-w-0" :aria-current="active ? 'step' : undefined">
    <div class="me-3 flex shrink-0 flex-col items-center" aria-hidden="true">
      <span
        :class="[
          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm leading-none font-semibold transition-colors duration-150',
          done
            ? 'bg-stepper-indicator-done text-stepper-indicator-fg'
            : active
              ? 'bg-stepper-indicator-active text-stepper-indicator-fg'
              : 'bg-stepper-indicator-default text-stepper-indicator-default-text',
        ]"
      >
        <OIcon v-if="done" name="check" size="sm" class="size-4" />
        <template v-else>{{ number }}</template>
      </span>
      <span
        class="mt-1 w-px flex-1 group-last/steps:hidden"
        :class="done ? 'bg-stepper-connector-done' : 'bg-stepper-connector'"
      />
    </div>
    <div class="flex min-w-0 flex-1 flex-col pb-6">
      <h2
        :class="[
          'flex min-h-8 items-center px-1.5 text-sm leading-tight font-medium',
          active
            ? 'text-stepper-title-active'
            : done
              ? 'text-stepper-title-done'
              : 'text-stepper-title-default',
        ]"
      >
        {{ title }}
        <span v-if="done" class="sr-only">{{ t("onboarding.stepDone") }}</span>
      </h2>
      <div class="mt-2 min-w-0">
        <slot />
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  n: number;
  title: I18nText;
  done?: boolean;
  /** The first step that is not done. */
  active?: boolean;
}>();

const { t } = useI18nTyped();

const number = raw(String(props.n));
</script>
