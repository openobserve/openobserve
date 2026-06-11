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
  Thin wrapper kept for its existing name/contract; the empty-state UI now
  lives in src/components/common/empty-states/NoPanels.vue.
-->
<template>
  <NoPanels :view-only="viewOnly" @add="$emit('update:Panel')" />
</template>

<script lang="ts">
import { defineComponent } from "vue";
import NoPanels from "@/components/common/empty-states/NoPanels.vue";

export default defineComponent({
  name: "NoPanel",
  props: ["Panel", "viewOnly"],
  emits: ["update:Panel"],
  components: { NoPanels },
});
</script>
