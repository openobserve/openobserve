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

<!-- The guide page's step nav: the guide's own steps, in order, each a link to its place in the
     guide, with a short state on the step that checks for data. The live status itself stays in
     the guide. -->
<template>
  <nav
    class="flex flex-col gap-4"
    :aria-label="t('onboarding.rail.label')"
    data-test="onboarding-guide-rail"
  >
    <h2 class="text-text-heading text-base leading-snug font-semibold text-balance">
      {{ t("onboarding.rail.title", { name }) }}
    </h2>
    <ol>
      <li
        v-for="(s, i) in steps"
        :key="s.id"
        class="group/rail flex min-w-0"
        :data-done="s.done"
        :data-test="`onboarding-guide-rail-${s.id}`"
      >
        <div class="me-3 flex shrink-0 flex-col items-center pt-1" aria-hidden="true">
          <span
            :class="[
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs leading-none font-semibold transition-colors duration-150',
              s.done
                ? 'bg-stepper-indicator-done text-stepper-indicator-fg'
                : s.active
                  ? 'bg-stepper-indicator-active text-stepper-indicator-fg'
                  : 'bg-stepper-indicator-default text-stepper-indicator-default-text',
            ]"
          >
            <OIcon v-if="s.done" name="check" size="xs" />
            <template v-else>{{ raw(String(i + 1)) }}</template>
          </span>
          <span
            class="mt-1 w-px flex-1 group-last/rail:hidden"
            :class="s.done ? 'bg-stepper-connector-done' : 'bg-stepper-connector'"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col pb-4 group-last/rail:pb-0">
          <OButton
            variant="ghost-muted"
            size="sm"
            class="-ms-2 justify-start text-start"
            :aria-current="s.active ? 'step' : undefined"
            :data-test="`onboarding-guide-rail-${s.id}-link`"
            @click="emit('go', s.id)"
          >
            <span
              :class="[
                'truncate font-medium',
                s.active
                  ? 'text-stepper-title-active'
                  : s.done
                    ? 'text-stepper-title-done'
                    : 'text-stepper-title-default',
              ]"
              >{{ s.title }}</span
            >
            <span v-if="s.done" class="sr-only">{{ t("onboarding.stepDone") }}</span>
          </OButton>
          <p
            v-if="s.status"
            :class="[
              'flex items-center gap-1.5 text-xs',
              s.status.tone === 'ok'
                ? 'text-success'
                : s.status.tone === 'attention'
                  ? 'text-warning'
                  : 'text-text-secondary',
            ]"
            :data-test="`onboarding-guide-rail-${s.id}-status`"
            :data-tone="s.status.tone"
          >
            <OIcon
              :name="
                s.status.tone === 'ok'
                  ? 'check-circle'
                  : s.status.tone === 'attention'
                    ? 'warning'
                    : 'schedule'
              "
              size="xs"
            />
            {{ s.status.text }}
          </p>
        </div>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

export interface GuideNavStep {
  id: string;
  title: I18nText;
  done: boolean;
  active: boolean;
  /** A short state under the step that checks for data. */
  status?: { text: I18nText; tone: "waiting" | "ok" | "attention" };
}

defineProps<{
  /** The source the guide sets up. */
  name: I18nText;
  steps: GuideNavStep[];
}>();
const emit = defineEmits<{ go: [id: string] }>();

const { t } = useI18nTyped();
</script>
