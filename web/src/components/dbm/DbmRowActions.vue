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
  Alerts lists — one consistent "Actions" column across the product rather than
  a DBM-only hover-reveal. They stay in the DOM and focusable, so keyboard users
  reach them in tab order and screen readers announce them.
-->
<template>
  <div class="flex items-center justify-end gap-1" :data-test="dataTest">
    <OButton
      v-for="action in actions"
      :key="action.id"
      variant="ghost"
      size="icon-sm"
      :icon-left="action.icon"
      :data-test="`${dataTest}-${action.id}`"
      @click.stop="emit('action', action.id)"
    >
      <!-- `left`, the convention for an icon-only action in a table's trailing
           cell — it opens INTO the row rather than over the row above. These
           buttons carry no label, so the tooltip is the only thing naming them. -->
      <OTooltip side="left" :content="action.label" />
    </OButton>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

/** One row action. `id` is what the row emits back to the page. */
export interface DbmRowAction {
  id: string;
  icon: IconName;
  label: I18nText;
}

withDefaults(
  defineProps<{
    actions?: DbmRowAction[];
    dataTest?: string;
  }>(),
  { actions: () => [], dataTest: "dbm-row-actions" },
);

const emit = defineEmits<{ (e: "action", id: string): void }>();
</script>
