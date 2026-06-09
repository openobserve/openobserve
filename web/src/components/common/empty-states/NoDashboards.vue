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
  NoDashboards — empty state for the dashboards list (a folder with no
  dashboards). Action-first: a compact brand icon badge sets context while the
  three QuickStartCards (with the recommended one emphasized) are the focal
  call-to-action. Tailwind-only, token-based. Emits create / import / templates.
-->
<template>
  <EmptyState
    title="No dashboards in this folder yet"
    description="Create your first dashboard to start visualizing logs, metrics, and traces — or import an existing one."
    actions-label="Quick start"
  >
    <template #illustration>
      <!-- Animated SVG illustration — subtle motion conveys the "empty, waiting"
           state without competing with the action below. -->
      <EmptyDashboards data-test="empty-dashboards-art" />
    </template>

    <template #actions>
      <QuickStartCard
        icon="dashboard"
        label="Blank dashboard"
        sublabel="Start from an empty canvas"
        data-test="dashboard-empty-new"
        @click="$emit('create')"
      />
      <QuickStartCard
        icon="upload-file"
        label="Import"
        sublabel="From a file or URL"
        data-test="dashboard-empty-import"
        @click="$emit('import')"
      />
      <QuickStartCard
        icon="dashboard-customize"
        label="Templates"
        sublabel="Prebuilt gallery"
        data-test="dashboard-empty-templates"
        @click="$emit('templates')"
      />
    </template>

    <template #extra>
      <p class="tw:text-xs tw:text-text-secondary">
        Dashboards turn your logs, metrics, and traces into shareable
        visualizations.
      </p>
    </template>
  </EmptyState>
</template>

<script setup lang="ts">
import EmptyState from "./EmptyState.vue";
import QuickStartCard from "./QuickStartCard.vue";
import EmptyDashboards from "../illustrations/EmptyDashboards.vue";

defineEmits<{ create: []; import: []; templates: [] }>();
</script>
