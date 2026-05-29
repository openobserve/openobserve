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
  <div class="card-container tw:h-full tw:flex tw:flex-col tw:pb-[0.3rem]">
    <!-- Current org section (if super org, not a member) -->
    <div v-if="currentOrgToShow" class="tw:mb-3">
      <div
        class="member-header"
        :class="
          store.state.theme === 'dark'
            ? 'member-header-dark'
            : 'member-header-light'
        "
      >
        <div class="text-bold q-px-sm q-py-sm">
          {{ t("billing.billingGroup.currentOrgTitle") }}
        </div>
        <q-separator class="tw:mb-1 tw:mt-[3px]" size="2px" />

        <button
          type="button"
          class="current-org-item"
          :class="{ 'current-org-item--active': activeMember === '' }"
          :data-test="`usage-member-tab-current`"
          @click="activeMember = ''"
        >
          <div class="member-name" :title="currentOrgToShow.title">
            {{ currentOrgToShow.primary }}
          </div>
          <div
            v-if="currentOrgToShow.secondary"
            class="member-id"
            :title="currentOrgToShow.secondary"
          >
            {{ currentOrgToShow.secondary }}
          </div>
        </button>
      </div>
    </div>

    <!-- Member organizations section -->
    <div class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0">
      <div
        class="member-header"
        :class="
          store.state.theme === 'dark'
            ? 'member-header-dark'
            : 'member-header-light'
        "
      >
        <div class="text-bold q-px-sm q-py-sm">
          {{ t("billing.billingGroup.memberOrgsTitle") }}
        </div>
        <q-separator class="tw:mb-1 tw:mt-[3px]" size="2px" />

        <div class="flex member-item q-py-xs tw:w-full">
          <q-input
            v-model="searchQuery"
            dense
            borderless
            clearable
            data-test="usage-member-search"
            :placeholder="t('billing.billingGroup.searchMemberOrg')"
            class="tw:mx-2 q-px-xs tw:w-full"
            :class="
              store.state.theme === 'dark'
                ? 'o2-search-input-dark'
                : 'o2-search-input-light'
            "
          >
            <template #prepend>
              <q-icon
                class="o2-search-input-icon"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-search-input-icon-dark'
                    : 'o2-search-input-icon-light'
                "
                name="search"
              />
            </template>
          </q-input>
        </div>
      </div>

      <div class="members-tabs tw:flex-1 tw:overflow-y-auto">
        <OTabs
          orientation="vertical"
          v-model="activeMember"
          data-test="usage-member-tabs"
        >
          <OTab
            v-for="opt in filteredOptions"
            :key="opt.value"
            :name="opt.value"
            :data-test="`usage-member-tab-${opt.value || 'current'}`"
          >
            <div class="member-item full-width">
              <div class="member-name" :title="opt.title">
                {{ opt.primary }}
              </div>
              <div v-if="opt.secondary" class="member-id" :title="opt.secondary">
                {{ opt.secondary }}
              </div>
            </div>
          </OTab>
        </OTabs>

        <div
          v-if="filteredOptions.length === 0"
          class="o2-page-subtitle tw:text-center tw:py-4 tw:px-2"
          data-test="usage-member-no-results"
        >
          {{ t("billing.billingGroup.noMemberMatch") }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

export interface MemberOrg {
  id: string;
  name: string;
}

export default defineComponent({
  name: "UsageMemberList",
  components: { OTabs, OTab },
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    members: {
      type: Array as () => MemberOrg[],
      default: () => [],
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const searchQuery = ref("");

    const activeMember = computed({
      get: () => props.modelValue,
      set: (val: string) => emit("update:modelValue", val),
    });

    const currentOrgId = computed(() => store.state.selectedOrganization.identifier);

    // Check if current org is a member org (super org if not found in members)
    const currentOrgInMembers = computed(() => {
      return props.members.some((m) => m.id === currentOrgId.value);
    });

    // Current org display data (only if it's a super org, not in members list)
    const currentOrgToShow = computed(() => {
      if (currentOrgInMembers.value) {
        return null;
      }
      const currentOrg = store.state.selectedOrganization;
      const orgName = currentOrg.label || currentOrg.name;
      return {
        value: "current",
        primary: orgName || currentOrg.identifier,
        secondary: orgName ? currentOrg.identifier : "",
        title: orgName
          ? `${orgName} | ${currentOrg.identifier}`
          : currentOrg.identifier,
      };
    });

    const options = computed(() =>
      props.members.map((m) => ({
        value: m.id,
        primary: m.name || m.id,
        secondary: m.name ? m.id : "",
        title: m.name ? `${m.name} | ${m.id}` : m.id,
      })),
    );

    const filteredOptions = computed(() => {
      const q = searchQuery.value?.toLowerCase().trim();
      if (!q) return options.value;
      return options.value.filter(
        (o) =>
          o.primary.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q)
      );
    });

    return {
      t,
      store,
      searchQuery,
      activeMember,
      filteredOptions,
      currentOrgToShow,
    };
  },
});
</script>

<style lang="scss" scoped>
.current-org-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: calc(100% - 10px);
  min-width: 0;
  margin: 5px;
  padding: 0.375rem 1rem 0.375rem 1.25rem;
  border-radius: 0.5rem;
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;

  &:hover {
    background-color: var(--o2-hover-bg, rgba(0, 0, 0, 0.06));
  }

  &--active {
    background-color: var(--o2-primary-btn-bg);
    color: white;

    &:hover {
      background-color: var(--o2-primary-btn-bg);
    }

    .member-id {
      opacity: 0.85;
    }
  }

  // Dark mode overrides — hover is invisible on #1a1a1a without these
  .member-header-dark &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }

  .member-header-dark &--active,
  .member-header-dark &--active:hover {
    background-color: var(--o2-primary-btn-bg);
    color: white;
  }

  .member-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-transform: none;
  }

  .member-id {
    font-size: 0.72rem;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-transform: none;
  }
}

.member-header {
  border-radius: 0.625rem;

  &.member-header-light {
    background-color: white;
  }
  &.member-header-dark {
    background-color: #1a1a1a;
  }
}

.members-tabs {
  .o-tabs {
    height: auto !important;
    max-height: none !important;
  }

  .member-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
  }

  .member-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-transform: none;
  }

  .member-id {
    font-size: 0.72rem;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-transform: none;
  }

  .o-tabs {
    &--vertical {
      margin: 5px;

      .o-tab {
        justify-content: flex-start;
        padding: 0.375rem 1rem 0.375rem 1.25rem;
        border-radius: 0.5rem;
        min-height: 1.5rem;
        text-transform: none;

        &--active {
          background-color: var(--o2-primary-btn-bg);
          color: white;

          .member-id {
            opacity: 0.85;
          }
        }
      }
    }
  }
}
</style>
