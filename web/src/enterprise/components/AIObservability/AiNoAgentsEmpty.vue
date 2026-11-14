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
  AiNoAgentsEmpty — the "no agents discovered" hero empty state shared by the
  AI pages. It reproduces SessionsList's constellation empty state EXACTLY
  (same OEmptyState, same size, same data-test passthrough) and parameterizes:

    - `dataTest` / `title` / `description` / `actionLabel` — each page passes
      its own resolved strings + data-test so the rendered markup is identical.
    - `illustration` — defaults to `constellation` (Sessions). Agent Graph uses
      `service-graph`.
    - `actionLabel` is optional: when absent no action button renders (Graph has
      no "view by stream" action).

  The `view-by-stream` event fires when the action is triggered.
-->
<template>
  <OEmptyState
    :icon="icon"
    :data-test="dataTest"
    :title="title"
    :text="description"
    :action-label="actionLabel"
    @action="$emit('view-by-stream')"
  />
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

withDefaults(
  defineProps<{
    /** data-test emitted on the empty state (each page keeps its own value). */
    dataTest: string;
    /** Resolved title string. */
    title: I18nText;
    /** Resolved description string. */
    description: I18nText;
    /** Resolved action-label string. Omit for pages with no action (Graph). */
    actionLabel?: I18nText;
    /** Agent Graph passes `hub`. */
    icon?: IconName;
  }>(),
  {
    icon: "insights",
  },
);

defineEmits<{
  (e: "view-by-stream"): void;
}>();
</script>
