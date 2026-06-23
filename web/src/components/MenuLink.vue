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
  <!-- Single dynamic root so external links (<a>), internal links (<router-link>)
       and submenu-group triggers (<button>, used by ONavGroup) all share the
       exact same tile markup and styling — a group tile is literally a MenuLink. -->
  <component
    :is="rootComponent"
    v-bind="rootProps"
    :class="rootClass"
    @click="onRootClick"
  >
    <div class="nav-menu-item-avatar tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:w-full">
      <div
        class="icon-wrapper tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
        :class="isActive
          ? activeIconClass
          : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >
        <!-- Rail icons are a hair smaller than the md (24px) default. -->
        <OIcon v-if="icon" :name="icon" size="md" class="tw:size-5.5!" />
        <component
          v-else-if="hasIconComponent"
          :is="iconComponent"
          class="o-icon tw:size-5.5"
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
        class="nav-menu-item-label tw:text-[0.71875rem] tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
        :class="isActive
          ? activeLabelClass
          : 'tw:font-medium tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>

    <!-- Submenu affordance: hidden at rest so a group/link-with-subnav tile is
         indistinguishable from a plain tile (consistency). It fades in only on
         hover, or stays lit while the flyout is open / the section is active. -->
    <span
      v-if="asTrigger || submenu"
      class="tw:absolute tw:right-1 tw:top-3 tw:transition-opacity tw:duration-150"
      :class="isActive || expanded
        ? 'tw:opacity-100 tw:text-primary-600'
        : 'tw:opacity-0 tw:group-hover:opacity-70 tw:text-tabs-inactive-text'"
      aria-hidden="true"
    >
      <OIcon name="chevron-right" size="xs" />
    </span>
  </component>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";
import { useRouter, RouterLink } from "vue-router";
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

    // Trigger mode — render as a non-navigating <button> that opens a submenu
    // (used by ONavGroup for a group header). In this mode `active` is supplied
    // by the parent (the group is active when any child route is active) and
    // `expanded` reflects the open flyout for aria + the caret state.
    asTrigger: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: false,
    },
    expanded: {
      type: Boolean,
      default: false,
    },
    // Show the submenu caret on a normal link (it reveals sub-pages on hover but
    // still navigates on click). `asTrigger` implies this for pure groups.
    submenu: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["trigger"],
  setup(props, { emit }) {
    const store = useStore();
    const router: any = useRouter();

    const openWebPage = (url: string) => {
      window.open(url, "_blank");
    };

    // Compute the tile's active state.
    // In trigger mode the parent owns the active flag; otherwise we derive it
    // from the route. Home (link === '/') needs special handling because every
    // path starts with '/' — match by route name "home". Others prefix-match.
    const isActive = computed(() => {
      if (props.asTrigger) return props.active;
      // Explicit override — link+subnav group tiles (e.g. Data) pass `active`
      // computed from "is ANY child route active", since their children live
      // under different path roots than the tile's own link.
      if (props.active) return true;
      const route = router.currentRoute.value;
      if (props.link === "/") {
        return route.name === "home" || route.path === "/" || route.path === "";
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
        : "tw:text-primary-700 tw:bg-surface-base tw:shadow-sm tw:border-l-2 tw:border-primary-600",
    );
    const activeIconClass = computed(() =>
      isDark.value ? "tw:text-tabs-active-text!" : "tw:text-primary-700!",
    );
    const activeLabelClass = computed(() =>
      isDark.value
        ? "tw:font-semibold tw:text-tabs-active-text!"
        : "tw:font-semibold tw:text-primary-600!",
    );

    // Phase 5: Accessibility - compute ARIA label with fallback
    const ariaLabel = computed(() => {
      let label = props.title || "Navigation link";
      if (props.badge && props.badge > 0) {
        label += ` (${props.badge} notifications)`;
      }
      if (isActive.value) {
        label += " - Current page";
      }
      return label;
    });

    // The default prop is an empty object `{}`; only render a custom icon
    // component when a real one was passed.
    const hasIconComponent = computed(() => {
      const c: any = props.iconComponent;
      return !!c && (typeof c === "function" || Object.keys(c).length > 0);
    });

    // Resolve the root element/component for the current mode.
    const rootComponent = computed(() =>
      props.external ? "a" : props.asTrigger ? "button" : RouterLink,
    );

    // Attributes bound to the root, per mode. Kept in one place so the three
    // modes can never drift apart visually.
    const rootProps = computed<Record<string, any>>(() => {
      const common: Record<string, any> = {
        "data-test": `menu-link-${props.link}-item`,
        title: props.title,
        "aria-label": ariaLabel.value,
      };
      if (props.external) {
        return {
          ...common,
          href: "#",
          target: props.target,
          "aria-current": isActive.value ? "page" : undefined,
        };
      }
      if (props.asTrigger) {
        return {
          ...common,
          type: "button",
          "aria-haspopup": "menu",
          "aria-expanded": props.expanded,
        };
      }
      return {
        ...common,
        to: {
          path: props.link,
          query: { org_identifier: store.state.selectedOrganization?.identifier },
        },
        target: props.target,
        "aria-current": isActive.value ? "page" : undefined,
      };
    });

    const rootClass = computed(() => [
      "nav-menu-item",
      "tw:group tw:relative tw:block tw:[text-decoration:none]! tw:text-inherit tw:shrink-0 tw:mx-1 tw:px-0 tw:py-1 tw:min-h-0 tw:rounded-lg tw:transition-colors tw:duration-150 tw:ease-out tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500 tw:focus-visible:ring-offset-1",
      isActive.value
        ? activePillClass.value
        : "tw:text-tabs-inactive-text tw:border-l-2 tw:border-transparent tw:bg-transparent tw:hover:bg-tabs-hover-bg",
      isActive.value ? "nav-menu-item--active" : "",
      props.title === "Functions" ? "menu-link-function" : "",
      // Reset native <button> chrome so the trigger looks EXACTLY like a link.
      // NOTE: do NOT set a background here — the active/inactive branch above owns
      // it. `appearance-none` clears the native button background; adding
      // `bg-transparent` here would override the active pill and break the
      // selected-state highlight. `font:inherit` keeps the label font identical.
      props.asTrigger
        ? "tw:w-full tw:appearance-none tw:border-0 tw:cursor-pointer tw:text-left tw:[font-family:inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:[letter-spacing:inherit]"
        : "",
    ]);

    const onRootClick = (event: MouseEvent) => {
      if (props.external) {
        event.preventDefault();
        openWebPage(props.link);
        return;
      }
      if (props.asTrigger) {
        emit("trigger", event);
      }
    };

    return {
      store,
      router,
      openWebPage,
      isActive,
      ariaLabel,
      activePillClass,
      activeIconClass,
      activeLabelClass,
      hasIconComponent,
      rootComponent,
      rootProps,
      rootClass,
      onRootClick,
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
