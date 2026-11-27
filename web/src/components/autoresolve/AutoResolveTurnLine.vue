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
  <!-- Narrow slots keep room for two lines, so the wrapped notice keeps its time and moves nothing. -->
  <div class="@container/turn min-w-0" data-test="autoresolve-run-turn">
    <div
      class="flex min-h-6 min-w-0 items-center @max-[40rem]/turn:min-h-10 @max-[40rem]/turn:items-start"
    >
      <OInlineNotice
        v-if="line.silent"
        variant="warning"
        :text="line.text"
        wrap
        data-test="autoresolve-run-silent"
      />
      <p
        v-else
        class="text-text-body text-compact m-0 flex min-w-0 items-center gap-2 tabular-nums"
        data-test="autoresolve-run-turn-status"
      >
        <OSpinner v-if="line.spinner" size="xs" />
        {{ line.text }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { AutoResolveRun } from "@/services/autoresolve";
import { useI18nTyped } from "@/types/i18n";
import { turnLine } from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{
  run: AutoResolveRun;
  /** The page's clock, ticking each second while a turn is live. */
  nowUs: number;
}>();

const { t } = useI18nTyped();

const line = computed(() => turnLine(props.run, props.nowUs, t));
</script>
