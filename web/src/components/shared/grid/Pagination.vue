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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<template>
  <div
    :class="position === 'bottom' ? 'py-2' : 'pt-2'"
    class="w-full flex justify-between"
  >
    <div
      v-if="position === 'bottom' && maxRecords"
      class="flex items-center whitespace-nowrap w-50 justify-center justify-start"
    >
      <span class="mr-4 text-xs font-semibold">{{ t("search.maxRecords") }}</span>
      <OInput
        v-model="maxRecords"
        @blur="changeMaxRecordToReturn"
      />
    </div>
    <div
      v-if="position === 'top' && pageTitle"
      class="font-bold flex items-center"
    >
      <OButton
        v-if="
          collapsibleIcon === 'show' &&
          searchCollapseImage == 'collapse_sidebar_icon'
        "
        variant="ghost"
        size="icon"
        class="mr-2"
        @click="toggleSidePanel"
      >
        <img
          :src="getImageURL('images/common/collapse_sidebar_icon.svg')"
          width="16"
          height="16"
        />
      </OButton>
      <OButton
        v-if="
          collapsibleIcon === 'show' &&
          searchCollapseImage == 'expand_sidebar_icon'
        "
        variant="ghost"
        size="icon"
        class="mr-2"
        @click="toggleSidePanel"
      >
        <img
          :src="getImageURL('images/common/expand_sidebar_icon.svg')"
          width="16"
          height="16"
        />
      </OButton>
      <div class="ml-1">
        {{ resultTotal }}
        {{ pageTitle.slice(-1) == "s" ? pageTitle.slice(0, -1) : pageTitle }}(s)
      </div>
    </div>
    <div class="ml-auto">
      <span class="mr-4 text-xs font-semibold">
        {{ t("search.showing") }}
        {{
          resultTotal > 0
            ? (scope.pagination.page - 1) * scope.pagination.rowsPerPage + 1
            : 0
        }}
        -
        {{
          scope.pagination.page * scope.pagination.rowsPerPage >= resultTotal
            ? resultTotal
            : scope.pagination.page * scope.pagination.rowsPerPage
        }}
        {{ t("search.of") }} {{ resultTotal }}

        <!-- {{ (scope.pagination.page - 1) * scope.pagination.rowsPerPage + 1 }}-{{
          scope.pagination.page * scope.pagination.rowsPerPage
        }}
        of {{ resultTotal }} -->
      </span>

      <div v-if="position === 'bottom'" class="flex items-center">
        <OSeparator vertical class="my-2 mr-4" />

        <span class="mr-4 text-xs font-semibold">
          {{ t("search.recordsPerPage") }}
        </span>
        <OSelect
          v-model="scope.pagination.rowsPerPage"
          class="mr-3"
          :options="perPageOptions"
          @update:modelValue="changePagination"
        />
      </div>

      <OButtonGroup>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="scope.isFirstPage"
          @click="scope.prevPage"
          icon-left="chevron-left"
        >
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="scope.isLastPage"
          @click="scope.nextPage"
          icon-left="chevron-right"
        >
        </OButton>
      </OButtonGroup>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { getImageURL } from "../../../utils/zincutils";

export default defineComponent({
  name: "QTablePagination",
  components: { OSeparator, OButtonGroup, OButton },

  props: [
    "scope",
    "pageTitle",
    "resultTotal",
    "maxRecordToReturn",
    "changeRecordPerPage",
    "perPageOptions",
    "position",
    "collapsibleIcon",
  ] as string[],
  emits: ["update", "update:maxRecordToReturn", "update:changeRecordPerPage"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const router = useRouter();
    const maxRecords = ref(props.maxRecordToReturn);
    const store = useStore();
    const searchCollapseImage: any = ref("collapse_sidebar_icon");

    const changePagination = (val: any) => {
      emit("update:changeRecordPerPage", val);
    };

    const changeMaxRecordToReturn = (e: { target: { value: any } }) => {
      emit("update:maxRecordToReturn", e.target.value);
    };

    const toggleSidePanel = () => {
      store.dispatch(
        "setSearchCollapseToggle",
        store.state.searchCollapsibleSection == 0 ? 20 : 0,
      );
    };

    return {
      t,
      store,
      router,
      maxRecords,
      toggleSidePanel,
      searchCollapseImage,
      changePagination,
      changeMaxRecordToReturn,
      getImageURL,
    };
  },
  computed: {
    sidebarIcon() {
      return this.store.state.searchCollapsibleSection;
    },
  },
  watch: {
    sidebarIcon(newVal: any, oldVal: any) {
      if (newVal != oldVal && this.router.currentRoute.value.name == "logs") {
        if (this.store.state.searchCollapsibleSection == 0) {
          this.searchCollapseImage = "expand_sidebar_icon";
        } else {
          this.searchCollapseImage = "collapse_sidebar_icon";
        }
      }
    },
  },
});
</script>

