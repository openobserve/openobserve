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
    v-if="requirements.length > 0"
    class="tw:mt-2 tw:flex tw:flex-col tw:gap-2"
  >
    <!-- Progress over the policy's own requirements, not an entropy score. -->
    <q-linear-progress
      v-if="showStrength"
      :value="metCount / requirements.length"
      size="4px"
      rounded
      :color="metCount === requirements.length ? 'positive' : 'primary'"
      data-test="password-requirements-strength"
    />

    <ul
      class="tw:grid tw:grid-cols-1 tw:gap-x-4 tw:gap-y-1.5 tw:sm:grid-cols-2"
    >
      <li
        v-for="requirement in requirements"
        :key="requirement.key"
        :data-test="`password-requirement-${requirement.key}`"
        class="tw:flex tw:items-center tw:gap-2 tw:text-xs"
        :class="isMet(requirement) ? 'text-positive' : 'text-grey-7'"
      >
        <q-icon
          :name="isMet(requirement) ? 'check_circle' : 'radio_button_unchecked'"
          size="14px"
        />
        {{ requirement.label }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import {
  countMetRequirements,
  type PasswordRequirement,
} from "@/utils/passwordComplexity";

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

const metCount = computed(() =>
  countMetRequirements(props.requirements, props.password),
);

const isMet = (requirement: PasswordRequirement) =>
  requirement.isMet(props.password);
</script>
