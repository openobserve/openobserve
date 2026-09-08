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
  The "Configuration" pane header for every workflow node body — matches the
  Input / Output pane headers (same h-8 height + bold title) so all panes line up
  on one row. The default slot sits right after the title for per-node affordances
  (e.g. the Condition guidelines info icon).
-->
<template>
  <div class="flex h-8 shrink-0 items-center gap-1.5 ps-2">
    <span class="text-text-body text-sm font-bold">{{ t("workflow.ndv.config") }}</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>
