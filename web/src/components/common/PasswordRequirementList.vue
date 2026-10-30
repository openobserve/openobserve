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
  <div v-if="requirements.length > 0" class="mt-2 flex flex-col gap-2">
    <!-- Progress over the policy's own requirements, not an entropy score. -->
    <OProgressBar
      v-if="showStrength"
      :value="metCount / requirements.length"
      size="xs"
      :variant="metCount === requirements.length ? 'success' : 'default'"
      data-test="password-requirements-strength"
    />

    <ul class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
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
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
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

const isMet = (requirement: PasswordRequirement) => requirement.isMet(props.password);
</script>
