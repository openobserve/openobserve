<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  One titled section of the SLO form.

  Exists because the form previously reached for `<OContent :title="…">`, and
  OContent has no `title` prop — it is purely the horizontal content-inset
  primitive. The unknown prop fell through to the DOM as an attribute, so every
  section heading silently rendered as nothing and the fields ran together with
  no visual grouping.
-->
<template>
  <OCard :data-test="dataTest">
    <OCardSection>
      <h3 class="text-text-heading mb-3 text-lg">{{ title }}</h3>
      <slot />
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

defineProps<{
  title: string;
  dataTest?: string;
}>();
</script>
