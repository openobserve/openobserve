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
  The instance password requirements, ticking as they are met.

  Shared by every form that sets a password so the console cannot state one rule in the reset
  dialog and a different one in the user form — the rows come from the policy the server enforces,
  never from a hardcoded list.
-->
<template>
  <div v-if="requirements.length > 0">
    <!-- Progress over the policy's own requirements, not an entropy score: a strength library
         would routinely disagree with the checklist directly below it. -->
    <div
      v-if="showStrength"
      data-test="password-requirements-strength"
      class="bg-surface-subtle mt-2 h-1 w-full overflow-hidden rounded-full"
    >
      <div
        class="h-full rounded-full transition-all duration-200"
        :class="metCount === requirements.length ? 'bg-status-positive' : 'bg-accent'"
        :style="{ width: `${strengthPercent}%` }"
      />
    </div>

    <ul class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
      <li
        v-for="requirement in requirements"
        :key="requirement.key"
        :data-test="`password-requirement-${requirement.key}`"
        class="flex items-center gap-2 text-xs"
        :class="isMet(requirement) ? 'text-status-positive' : 'text-text-secondary'"
      >
        <OIcon
          :name="isMet(requirement) ? 'check-circle' : 'radio-button-unchecked'"
          size="xs"
          class="shrink-0"
        />
        {{ requirement.label }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { countMetRequirements, type PasswordRequirement } from "@/utils/passwordComplexity";

const props = withDefaults(
  defineProps<{
    requirements: PasswordRequirement[];
    /** The password to check the rows against. */
    password?: string;
    /** Adds the progress bar above the rows. */
    showStrength?: boolean;
  }>(),
  { password: "", showStrength: false },
);

const metCount = computed(() => countMetRequirements(props.requirements, props.password));

const strengthPercent = computed(() =>
  props.requirements.length === 0 ? 0 : (metCount.value / props.requirements.length) * 100,
);

const isMet = (requirement: PasswordRequirement) => requirement.isMet(props.password);
</script>
