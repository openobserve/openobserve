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

Makes inheritance visible in the check editor. Purely presentational: the panel
owns the grouped fetch and the environment selection, so this renders one
environment's rows and never asks which one.
-->

<template>
  <!-- Inset comes from the panel's scroll region, which hosts this section. -->
  <section
    v-if="inherited.length"
    class="flex flex-col gap-2"
    data-test="synthetics-inherited-variables"
  >
    <div class="flex items-center gap-2">
      <h4 class="text-text-heading m-0 text-sm font-semibold">
        {{ t("synthetics.inherited.title") }}
      </h4>
      <OBadge variant="default" size="sm">{{ inherited.length }}</OBadge>
    </div>

    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      <li
        v-for="variable in inherited"
        :key="`${variable.scope}:${variable.name}`"
        class="flex items-center gap-2 text-sm"
        data-test="synthetics-inherited-variable"
      >
        <!-- The strike is the whole visible signal; the relation stays on the
             tooltip and accessible name so it is never strike-only. -->
        <span
          class="font-mono"
          :class="variable.overridden ? 'text-text-secondary line-through' : ''"
          :aria-label="
            variable.overridden ? t('synthetics.inherited.overriddenByCheck') : undefined
          "
          >{{ variable.name
          }}<OTooltip
            v-if="variable.overridden"
            :content="t('synthetics.inherited.overriddenByCheck')"
            side="top"
        /></span>
        <OTooltip
          v-if="variable.kind === 'secret'"
          :content="t('synthetics.variablesPanel.secretTooltip')"
          side="top"
        >
          <OIcon
            name="lock"
            size="xs"
            class="text-text-secondary cursor-help"
            data-test="synthetics-inherited-secret-lock"
          />
        </OTooltip>
        <!-- Same scope vocabulary as the Environments & Variables rail:
             public = Global, layers = an environment. Name on hover/aria. -->
        <OTooltip :content="scopeLabel(variable)" side="top">
          <OIcon
            :name="variable.scope === 'global' ? 'public' : 'layers'"
            size="xs"
            class="text-text-secondary cursor-help"
            role="img"
            :aria-label="scopeLabel(variable)"
            data-test="synthetics-inherited-scope-icon"
          />
        </OTooltip>

        <div class="ml-auto flex items-center gap-1">
          <!-- Fires only on non-uniformity; the env names live in the tooltip
               and on aria-label, so hover is not the only path to them. -->
          <OTooltip v-if="gapText(variable)" :content="gapText(variable)" side="top">
            <OBadge
              variant="warning"
              size="sm"
              class="cursor-help"
              role="img"
              :aria-label="gapText(variable)"
              data-test="synthetics-inherited-gap-badge"
            >
              <OIcon name="warning" size="xs" />
            </OBadge>
          </OTooltip>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ResolvedVariable } from "./resolved";
import { inheritedVariables } from "./resolved";

const props = withDefaults(
  defineProps<{
    /** One environment's resolved rows — the panel picks which environment. */
    rows: ResolvedVariable[];
    /** Environments each name fails to resolve in, from coverageGaps(). */
    gaps?: Map<string, string[]>;
  }>(),
  { gaps: () => new Map() },
);

const { t } = useI18nTyped();

const inherited = computed(() => inheritedVariables(props.rows));

function scopeLabel(variable: ResolvedVariable): I18nText {
  return variable.scope === "global" ? t("synthetics.variables.global") : raw(variable.scope);
}

function gapText(variable: ResolvedVariable): string {
  const missing = props.gaps.get(variable.name);
  if (!missing?.length) return "";
  return missing.length > 2
    ? t("synthetics.inherited.notInMany", { count: missing.length })
    : t("synthetics.inherited.notIn", { envs: missing.join(", ") });
}
</script>
