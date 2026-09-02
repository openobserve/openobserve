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
  DbmRowActions — the next step of the user's job, on the row they are already
  looking at.

  "Everything at your fingertips" fails quietly: a table where the only action
  is "open the row" makes every secondary task (copy the statement into a
  ticket, look at an example trace, set an alert) a three-step detour through a
  detail page. So the four things a reader actually does next live on the row.

  Always visible, matching the app-standard action column on the Dashboards and
  Alerts lists. They stay in the DOM and focusable, so keyboard users reach them
  in tab order and screen readers announce them.
-->
<template>
  <div class="flex items-center justify-end gap-0.5" :data-test="dataTest">
    <OButton
      v-for="action in actions"
      :key="action.id"
      variant="ghost"
      size="icon-xs-sq"
      :icon-left="action.icon"
      class="max-md:hidden"
      :data-test="`${dataTest}-${action.id}`"
      @click.stop="emit('action', action.id)"
    >
      <!-- Icon-only actions carry no label, so the tooltip names them; `left` opens it into the row, not over the row above. -->
      <OTooltip side="left" :content="action.label" />
    </OButton>
    <ODropdown side="bottom" align="end">
      <template #trigger>
        <OButton
          icon-left="more-vert"
          variant="ghost"
          size="icon-xs-sq"
          class="md:hidden"
          :data-test="moreTest"
          @click.stop
        />
      </template>
      <ODropdownItem
        v-for="action in actions"
        :key="action.id"
        :icon-left="action.icon"
        class="md:hidden"
        :data-test="`${dataTest}-${action.id}-menu`"
        @select="emit('action', action.id)"
      >
        <span>{{ action.label }}</span>
      </ODropdownItem>
    </ODropdown>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

/** One row action. `id` is what the row emits back to the page. */
export interface DbmRowAction {
  id: string;
  icon: IconName;
  label: I18nText;
}

const props = withDefaults(
  defineProps<{
    actions?: DbmRowAction[];
    dataTest?: string;
  }>(),
  { actions: () => [], dataTest: "dbm-row-actions" },
);

const moreTest = computed(() => `${props.dataTest.replace(/-row-actions$/, "")}-row-more-actions`);

const emit = defineEmits<{ (e: "action", id: string): void }>();
</script>
