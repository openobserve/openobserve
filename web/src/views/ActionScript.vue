<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page data-test="alerts-page" class="q-pa-none" style="min-height: inherit">
    <RouterView />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "ActionScript",
  setup() {
    const store = useStore();
    const { t } = useI18n();

    return {
      t,
      store,
    };
  },
});
</script>

<style scoped lang="scss">
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
.alerts-tabs {
  .q-tabs {
    &--vertical {
      margin: 16px 8px 0 8px;
      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        text-transform: capitalize;
        min-height: 40px !important;
        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $accent;
          color: black;
        }
      }
    }
  }
}
</style>
