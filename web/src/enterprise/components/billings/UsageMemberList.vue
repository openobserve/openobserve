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
  <div class="bg-card-glass-bg h-full flex flex-col pb-[0.3rem]">
    <!-- Current org section (if super org, not a member) -->
    <div v-if="currentOrgToShow" class="mb-3">
      <div class="rounded-default bg-card-glass-bg dark:bg-surface-base">
        <div class="font-semibold px-2 py-2">
          {{ t("billing.billingGroup.currentOrgTitle") }}
        </div>
        <OSeparator class="mb-1 mt-0.75" />

        <OTabs orientation="vertical" v-model="activeMember" data-test="usage-member-tab-current">
          <OTab name="" :data-test="`usage-member-tab-current-item`">
            <div class="member-item flex flex-col items-start w-full min-w-0">
              <div
                class="member-name font-semibold truncate max-w-full normal-case"
                :title="currentOrgToShow.title"
              >
                {{ currentOrgToShow.primary }}
              </div>
              <div
                v-if="currentOrgToShow.secondary"
                class="member-id text-xs opacity-60 truncate max-w-full normal-case"
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
    <div class="flex-1 flex flex-col min-h-0">
      <div class="rounded-default bg-card-glass-bg dark:bg-surface-base">
        <div class="font-semibold px-2 py-2">
          {{ t("billing.billingGroup.memberOrgsTitle") }}
        </div>
        <OSeparator class="mb-1 mt-0.75" />

        <div class="flex items-center py-1 w-full">
          <OInput
            v-model="searchQuery"
            data-test="usage-member-search"
            :placeholder="t('billing.billingGroup.searchMemberOrg')"
            class="mx-2 w-full"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OInput>
        </div>
      </div>

      <div class="members-tabs flex-1 overflow-y-auto px-1.5">
        <OTabs orientation="vertical" v-model="activeMember" data-test="usage-member-tabs">
          <OTab
            v-for="opt in filteredOptions"
            :key="opt.value"
            :name="opt.value"
            :data-test="`usage-member-tab-${opt.value}`"
          >
            <div class="member-item flex flex-col items-start w-full min-w-0">
              <div
                class="member-name font-semibold truncate max-w-full normal-case"
                :title="opt.title"
              >
                {{ opt.primary }}
              </div>
              <div
                v-if="opt.secondary"
                class="member-id text-xs opacity-60 truncate max-w-full normal-case"
                :title="opt.secondary"
              >
                {{ opt.secondary }}
              </div>
            </div>
          </OTab>
        </OTabs>

        <div
          v-if="filteredOptions.length === 0"
          class="o2-page-subtitle text-center py-4 px-2"
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
        (o) => o.primary.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
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

<style scoped>
/* keep(lib-override:o2-tabs): OTabs/OTab internals (.o-tabs--vertical, .o-tab,
   .o-tabs) are child-component DOM this component can only reach through :deep();
   the active-tab → .member-id opacity is a descendant state chain. */
.members-tabs :deep(.o-tabs--vertical) {
  margin: 0.3125rem;
}

/* Vertical padding only — the horizontal inset comes from OTab's vertical
   variant (--spacing-page-edge) so this rail aligns with the page header. */
.members-tabs :deep(.o-tabs--vertical .o-tab) {
  justify-content: flex-start;
  padding-block: 0.375rem;
  border-radius: 0.5rem;
  min-height: 1.5rem;
  text-transform: none;
}

.members-tabs :deep(.o-tabs--vertical .o-tab[data-state="active"] .member-id) {
  opacity: 0.85;
}

.members-tabs :deep(.o-tabs) {
  height: auto !important;
  max-height: none !important;
}
</style>
