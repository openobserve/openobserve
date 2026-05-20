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
  <div class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:p-1" style="font-size: 1.5rem">
    <img
      data-test="no-panel-image"
      :src="getImageURL('images/common/clipboard_icon.svg')"
      style="width: 230px; margin: 5vh auto 2rem"
      alt=""
    />
    <div class="tw:flex tw:justify-center tw:mb-3">
      <span>Start by adding your first dashboard panel</span>
    </div>
    <div class="tw:flex tw:justify-center" v-if="!viewOnly">
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="draft"
        style="font-size: 1rem"
        @click="$emit('update:Panel')"
        data-test="dashboard-if-no-panel-add-panel-btn"
      >
        {{ t('panel.add') }}
      </OButton>
    </div>
  </div>
</template>
<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../../utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "NoPanel",
  props: ["Panel", "viewOnly"],
  emits: ["update:Panel"],
  components: { OButton },

  setup() {
    const { t } = useI18n();

    return { t, getImageURL };
  },
});
</script>
