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
  Where this team's pages are mirrored.

  There is no `channel` field on a Team — the chat destination is
  `policy.destinations`, names of existing alert Destination rows, so that is
  what this lists. Deliberately NOT "escalate to a sibling team": teams are a
  flat list with no hierarchy, and labelling a handoff that way would tell
  somebody they still hold a page they have just given away.

  No test-page button here on purpose: this card lists the rooms a page is
  mirrored to, and Contact readiness — the panel directly below, which answers
  "would a page land, per person" — is where the one honest test belongs. Two
  buttons with the same label, firing the same request, side by side, read as
  two different tests.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-2 border px-3.5 py-3"
    data-test="oncall-team-reach"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.reachTeamTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.reachTeamHint") }}</OText>
    </span>

    <!-- A team with no destination is reachable only by whatever the rungs
         page directly, which is worth saying rather than showing a blank card. -->
    <p
      v-if="!destinations.length"
      class="text-text-secondary text-sm"
      data-test="oncall-reach-empty"
    >
      {{ t("oncall.reachNoDestinations") }}
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="name in destinations"
        :key="name"
        class="border-border-subtle flex items-center gap-3 border-b py-2 last:border-b-0"
        :data-test="`oncall-reach-${name}`"
      >
        <span class="flex min-w-0 flex-col">
          <!-- Destination names are as long as whoever created the alert
               destination made them, and this card sits in a narrow rail. -->
          <span class="text-text-heading truncate text-sm font-medium">
            {{ raw(name) }}
            <OTooltip side="left" :content="raw(name)" />
          </span>
          <span class="text-text-secondary truncate text-xs">
            {{ t("oncall.reachDestinationHint") }}
          </span>
        </span>
      </li>
    </ul>

  </div>
</template>

<script setup lang="ts">
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** `policy.destinations` — names of existing alert Destination rows. */
    destinations?: string[];
  }>(),
  { destinations: () => [] },
);

const { t } = useI18nTyped();
</script>
