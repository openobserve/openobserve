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

<!-- A person by display name inside a sentence; the email rides in the tooltip because two people can share a name. -->
<template>
  <span :data-test="dataTest" :class="truncate ? 'block min-w-0 truncate' : ''">
    <OTooltip side="bottom">
      <template #content>
        <span class="flex flex-col" data-test="oncall-person-name-tooltip">
          <span>{{ name }}</span>
          <span v-if="showsEmail" class="text-text-secondary font-normal">{{ raw(email) }}</span>
        </span>
      </template>
    </OTooltip>
    <span>{{ name }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOrgUserNames } from "@/composables/useOrgUserNames";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";
import { raw } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ email: string; dataTest?: string; truncate?: boolean }>(),
  { dataTest: "oncall-person-name", truncate: false },
);

const { nameOf } = useOrgUserNames();

const name = computed<I18nText>(() => raw(nameOf(props.email)));

/// The same two lines OAvatar's tooltip shows, so a name and its avatar never disagree.
const showsEmail = computed(() => nameOf(props.email) !== props.email);
</script>
