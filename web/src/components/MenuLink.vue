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
    <div class="nav-menu-item-avatar flex flex-col items-center gap-0.5 w-full">
      <div
        class="icon-wrapper relative inline-flex items-center justify-center rounded-lg p-0.5 transition-colors duration-250"
        :class="isActive
          ? activeIconClass
          : 'text-tabs-inactive-text group-hover:text-primary-600'"
      >
        <!-- Rail icons are a hair smaller than the md (24px) default. -->
        <OIcon v-if="icon" :name="icon" size="md" class="size-5.5!" />
        <component
          v-else-if="hasIconComponent"
          :is="iconComponent"
          class="o-icon size-5.5"
        />
        <div
          v-if="badge && badge > 0"
          class="menu-badge absolute -top-1 -right-2 min-w-4 h-4 px-1 bg-[linear-gradient(135deg,#ef4444_0%,#ec4899_100%)] border-2 border-[#0f172a] rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none shadow-[0_4px_8px_rgba(239,68,68,0.5)] animate-pulse z-1"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <div
        class="nav-menu-item-label text-[0.71875rem] tracking-[0.01em] transition-colors duration-250 w-full text-center leading-tight line-clamp-2 wrap-normal break-normal [hyphens:none]"
        :class="isActive
          ? activeLabelClass
          : 'font-medium text-tabs-inactive-text group-hover:text-primary-600'"
      >{{ title }}</div>
    </div>

    <!-- Submenu affordance: hidden at rest so a group/link-with-subnav tile is
         indistinguishable from a plain tile (consistency). It fades in only on
         hover, or stays lit while the flyout is open / the section is active. -->
    <span
      v-if="asTrigger || submenu"
      class="absolute right-1 top-3 transition-opacity duration-150"
      :class="isActive || expanded
        ? 'opacity-100 text-primary-600'
        : 'opacity-70 group-hover:opacity-100 text-tabs-inactive-text'"
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
        ? "text-tabs-active-text bg-tabs-active-bg shadow-sm border-l-2 border-primary-400"
        : "text-primary-700 bg-surface-base shadow-sm border-l-2 border-primary-600",
    );
    const activeIconClass = computed(() =>
      isDark.value ? "text-tabs-active-text!" : "text-primary-700!",
    );
    const activeLabelClass = computed(() =>
      isDark.value
        ? "font-semibold text-tabs-active-text!"
        : "font-semibold text-primary-600!",
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
      "group relative block [text-decoration:none]! text-inherit shrink-0 mx-1 px-0 py-1 min-h-0 rounded-lg transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
      isActive.value
        ? activePillClass.value
        : "text-tabs-inactive-text border-l-2 border-transparent bg-transparent hover:bg-tabs-hover-bg",
      isActive.value ? "nav-menu-item--active" : "",
      props.title === "Functions" ? "menu-link-function" : "",
      // Reset native <button> chrome so the trigger looks EXACTLY like a link.
      // NOTE: do NOT set a background here — the active/inactive branch above owns
      // it. `appearance-none` clears the native button background; adding
      // `bg-transparent` here would override the active pill and break the
      // selected-state highlight. `font:inherit` keeps the label font identical.
      props.asTrigger
        ? "w-full appearance-none border-0 cursor-pointer text-left [font-family:inherit] [font-size:inherit] [line-height:inherit] [letter-spacing:inherit]"
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
