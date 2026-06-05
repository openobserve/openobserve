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
      <div class="member-header">
        <div class="tw:font-semibold tw:px-2 tw:py-2">
          {{ t("billing.billingGroup.currentOrgTitle") }}
        </div>
        <OSeparator class="tw:mb-1 tw:mt-[3px]" />

        <OTabs
          orientation="vertical"
          v-model="activeMember"
          data-test="usage-member-tab-current"
        >
          <OTab name="" :data-test="`usage-member-tab-current-item`">
            <div class="member-item">
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
            </div>
          </OTab>
        </OTabs>
      </div>
    </div>

    <!-- Member organizations section -->
    <div class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0">
      <div class="member-header">
        <div class="tw:font-semibold tw:px-2 tw:py-2">
          {{ t("billing.billingGroup.memberOrgsTitle") }}
        </div>
        <OSeparator class="tw:mb-1 tw:mt-[3px]" />

        <div class="tw:flex tw:items-center tw:py-1 tw:w-full">
          <OInput
            v-model="searchQuery"
            data-test="usage-member-search"
            :placeholder="t('billing.billingGroup.searchMemberOrg')"
            class="tw:mx-2 tw:w-full"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OInput>
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
            :data-test="`usage-member-tab-${opt.value}`"
          >
            <div class="member-item">
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
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export interface MemberOrg {
  id: string;
  name: string;
}

export default defineComponent({
  name: "UsageMemberList",
  components: { OTabs, OTab, OSeparator, OInput, OIcon },
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

    const currentOrgInMembers = computed(() => {
      return props.members.some((m) => m.id === currentOrgId.value);
    });

    const currentOrgToShow = computed(() => {
      if (currentOrgInMembers.value) {
        return null;
      }
      const currentOrg = store.state.selectedOrganization;
      const label = currentOrg.label || currentOrg.identifier;
      return {
        value: "current",
        primary: label,
        secondary: currentOrg.label ? currentOrg.identifier : "",
        title: currentOrg.label
          ? `${currentOrg.label} | ${currentOrg.identifier}`
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
      searchQuery,
      activeMember,
      filteredOptions,
      currentOrgToShow,
    };
  },
});
</script>

<style lang="scss" scoped>
.member-header {
  border-radius: 0.625rem;
  background-color: var(--o2-card-bg);
}

.body--dark .member-header {
  background-color: var(--o2-card-background);
}

// Shared tab styles applied to both the current-org and member OTabs instances
.card-container {
  :deep(.o-tabs--vertical) {
    margin: 5px;

    .o-tab {
      justify-content: flex-start;
      padding: 0.375rem 1rem 0.375rem 1.25rem;
      border-radius: 0.5rem;
      min-height: 1.5rem;
      text-transform: none;

      &[data-state="active"] {
        .member-id {
          opacity: 0.85;
        }
      }
    }
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
}

.members-tabs {
  :deep(.o-tabs) {
    height: auto !important;
    max-height: none !important;
  }
}
</style>
