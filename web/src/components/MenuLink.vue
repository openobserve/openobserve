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
  <!-- External link → plain anchor -->
  <a
    v-if="external"
    :data-test="`menu-link-${link}-item`"
    href="#"
    :target="target"
    :class="[
      'nav-menu-item',
      'tw:group tw:block tw:[text-decoration:none]! tw:text-inherit tw:shrink-0 tw:mx-1 tw:px-0 tw:py-1 tw:min-h-0 tw:rounded-md tw:transition-colors tw:duration-250 tw:ease-in-out tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500 tw:focus-visible:ring-offset-1',
      'tw:text-tabs-inactive-text tw:border-l-2 tw:border-transparent',
      { 'menu-link-function': title === 'Functions' }
    ]"
    :aria-current="isActive ? 'page' : undefined"
    :aria-label="ariaLabel"
    :title="title"
    @click.prevent="openWebPage(link)"
  >
    <div v-if="icon" class="nav-menu-item-avatar tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:w-full">
      <div
        class="icon-wrapper tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
        :class="'tw:text-tabs-inactive-text tw:group-hover:bg-tabs-hover-bg tw:group-hover:text-primary-600'"
      >
        <OIcon
          :name="icon"
          size="md"
        />
        <div
          v-if="badge && badge > 0"
          class="menu-badge tw:absolute tw:-top-1 tw:-right-2 tw:min-w-4 tw:h-4 tw:px-1 tw:bg-[linear-gradient(135deg,#ef4444_0%,#ec4899_100%)] tw:border-2 tw:border-[#0f172a] tw:rounded-full tw:text-[9px] tw:font-bold tw:text-white tw:flex tw:items-center tw:justify-center tw:leading-none tw:shadow-[0_4px_8px_rgba(239,68,68,0.5)] tw:animate-pulse tw:z-1"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <div
        class="nav-menu-item-label tw:text-[12px] tw:font-medium tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
        :class="'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>
    <div v-else-if="iconComponent" class="nav-menu-item-avatar tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:w-full">
      <div
        class="icon-wrapper tw:relative tw:inline-block tw:transition-colors tw:duration-250"
        :class="'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >
        <component
          :is="iconComponent"
          class="o-icon tw:size-6"
        />
        <div
          v-if="badge && badge > 0"
          class="menu-badge tw:absolute tw:-top-1 tw:-right-2 tw:min-w-4 tw:h-4 tw:px-1 tw:bg-[linear-gradient(135deg,#ef4444_0%,#ec4899_100%)] tw:border-2 tw:border-[#0f172a] tw:rounded-full tw:text-[9px] tw:font-bold tw:text-white tw:flex tw:items-center tw:justify-center tw:leading-none tw:shadow-[0_4px_8px_rgba(239,68,68,0.5)] tw:animate-pulse tw:z-1"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <div
        class="nav-menu-item-label tw:text-[12px] tw:font-medium tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
        :class="'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>
  </a>

  <!-- Internal link → router-link (rendered as <a>) -->
  <router-link
    v-else
    :data-test="`menu-link-${link}-item`"
    :to="{
      path: link,
      query: {
        org_identifier: store.state.selectedOrganization?.identifier,
      },
    }"
    :class="[
      'nav-menu-item',
      'tw:group tw:block tw:[text-decoration:none]! tw:text-inherit tw:shrink-0 tw:mx-1 tw:px-0 tw:py-1 tw:min-h-0 tw:rounded-lg tw:transition-colors tw:duration-150 tw:ease-out tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500 tw:focus-visible:ring-offset-1',
      isActive
        ? activePillClass
        : 'tw:text-tabs-inactive-text tw:border-l-2 tw:border-transparent tw:hover:bg-tabs-hover-bg',
      { 'nav-menu-item--active': isActive, 'menu-link-function': title === 'Functions' }
    ]"
    :target="target"
    :aria-current="isActive ? 'page' : undefined"
    :aria-label="ariaLabel"
    :title="title"
  >
    <div v-if="icon" class="nav-menu-item-avatar tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:w-full">
      <div
        class="icon-wrapper tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
        :class="isActive
          ? activeIconClass
          : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >
        <OIcon
          :name="icon"
          size="md"
        />
        <div
          v-if="badge && badge > 0"
          class="menu-badge tw:absolute tw:-top-1 tw:-right-2 tw:min-w-4 tw:h-4 tw:px-1 tw:bg-[linear-gradient(135deg,#ef4444_0%,#ec4899_100%)] tw:border-2 tw:border-[#0f172a] tw:rounded-full tw:text-[9px] tw:font-bold tw:text-white tw:flex tw:items-center tw:justify-center tw:leading-none tw:shadow-[0_4px_8px_rgba(239,68,68,0.5)] tw:animate-pulse tw:z-1"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <div
        class="nav-menu-item-label tw:text-[12px] tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
        :class="isActive
          ? activeLabelClass
          : 'tw:font-medium tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>
    <div v-else-if="iconComponent" class="nav-menu-item-avatar tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:w-full">
      <div
        class="icon-wrapper tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
        :class="[
          isActive ? activeIconClass : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'
        ]"
      >
        <component
          :is="iconComponent"
          class="o-icon tw:size-6"
        />
        <div
          v-if="badge && badge > 0"
          class="menu-badge tw:absolute tw:-top-1 tw:-right-2 tw:min-w-4 tw:h-4 tw:px-1 tw:bg-[linear-gradient(135deg,#ef4444_0%,#ec4899_100%)] tw:border-2 tw:border-[#0f172a] tw:rounded-full tw:text-[9px] tw:font-bold tw:text-white tw:flex tw:items-center tw:justify-center tw:leading-none tw:shadow-[0_4px_8px_rgba(239,68,68,0.5)] tw:animate-pulse tw:z-1"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <div
        class="nav-menu-item-label tw:text-[12px] tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
        :class="isActive
          ? activeLabelClass
          : 'tw:font-medium tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>
  </router-link>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "MenuLink",
  components: { OIcon },
  props: {
    title: {
      type: String,
      required: true,
    },

    caption: {
      type: String,
      default: "",
    },

    link: {
      type: String,
      default: "#",
    },

    icon: {
      type: String,
      default: "",
    },

    iconComponent: {
      type: Object,
      default: () => ({}),
    },

    mini: {
      type: Boolean,
      default: true,
    },

    target: {
      type: String,
      default: "_self",
    },

    external: {
      type: Boolean,
      default: false,
    },

    // Phase 4: Badge support
    badge: {
      type: Number,
      default: 0,
    },
  },
  setup(props) {
    const store = useStore();
    const router: any = useRouter();

    const openWebPage = (url: string) => {
      window.open(url, "_blank");
    };

    // Phase 5: Accessibility - compute active state
    // Home (link === '/') needs special handling because every path starts with '/'
    // — match by route name "home" exactly. Other links use prefix-match on path.
    const isActive = computed(() => {
      const route = router.currentRoute.value;
      if (props.link === '/') {
        return route.name === 'home' || route.path === '/' || route.path === '';
      }
      return route.path.indexOf(props.link) === 0;
    });

    // Active-state styling is theme-aware: LIGHT keeps the classic white pill
    // with primary-coloured text/icon; DARK uses the tinted "selected" pill
    // (matching the dashboard-folder selection) with white text/icon — because
    // surface-base is black in dark mode, a white pill there would vanish.
    const isDark = computed(() => store.state.theme === "dark");
    const activePillClass = computed(() =>
      isDark.value
        ? "tw:text-tabs-active-text tw:bg-tabs-active-bg tw:shadow-sm tw:border-l-2 tw:border-primary-400"
        : "tw:text-primary-700 tw:bg-surface-base tw:shadow-sm tw:border-l-2 tw:border-primary-600"
    );
    const activeIconClass = computed(() =>
      isDark.value ? "tw:text-tabs-active-text!" : "tw:text-primary-700!"
    );
    const activeLabelClass = computed(() =>
      isDark.value
        ? "tw:font-semibold tw:text-tabs-active-text!"
        : "tw:font-semibold tw:text-primary-600!"
    );

    // Phase 5: Accessibility - compute ARIA label with fallback
    const ariaLabel = computed(() => {
      let label = props.title || 'Navigation link';
      if (props.badge && props.badge > 0) {
        label += ` (${props.badge} notifications)`;
      }
      if (isActive.value) {
        label += ' - Current page';
      }
      return label;
    });

    return {
      store,
      router,
      openWebPage,
      isActive,
      ariaLabel,
      activePillClass,
      activeIconClass,
      activeLabelClass,
    };
  },
});
</script>

<style scoped>
/* Locale-robust label wrapping for the narrow rail.
   - Wrap only at word boundaries (spaces): multi-word labels like
     "Data sources" split into two clean lines, while single words such as
     "Management" or "Incidents" stay on one line instead of being chopped into
     a hanging fragment ("Manageme / nt").
   - Clamp to two lines and hide the overflow so a verbose single-word
     translation (e.g. German "Einstellungen") truncates with an ellipsis on
     one tidy line rather than blowing up the row height; the full text is still
     available via the anchor's title tooltip and aria-label.
   - hyphens:none guarantees we never insert a dash character. */
.nav-menu-item-label {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: normal;
  word-break: normal;
  hyphens: none;
}
</style>
