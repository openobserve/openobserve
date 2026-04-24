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
  <!-- Internal link -->
  <RouterLink
    v-if="!external"
    :data-test="`menu-link-${link}-item`"
    :to="{
      path: link,
      query: { org_identifier: store.state.selectedOrganization?.identifier },
    }"
    :aria-current="isActive ? 'page' : undefined"
    :aria-label="ariaLabel"
    :class="[
      'menu-link',
      { 'menu-link--active': isActive, 'q-link-function': title === 'Functions' },
    ]"
  >
    <div class="menu-link__section">
      <div class="icon-wrapper">
        <q-icon
          v-if="icon"
          :name="icon"
          class="menu-link__icon"
        />
        <q-icon v-else-if="iconComponent" class="menu-link__icon">
          <component :is="iconComponent" />
        </q-icon>
        <div
          v-if="badge && badge > 0"
          class="menu-badge"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <span class="menu-link__label">{{ title }}</span>
    </div>
  </RouterLink>

  <!-- External link -->
  <a
    v-else
    :data-test="`menu-link-${link}-item`"
    :href="link"
    :target="target"
    rel="noopener noreferrer"
    :aria-label="ariaLabel"
    class="menu-link"
    @click.prevent="openWebPage(link)"
  >
    <div class="menu-link__section">
      <div class="icon-wrapper">
        <q-icon
          v-if="icon"
          :name="icon"
          class="menu-link__icon"
        />
        <q-icon v-else-if="iconComponent" class="menu-link__icon">
          <component :is="iconComponent" />
        </q-icon>
        <div
          v-if="badge && badge > 0"
          class="menu-badge"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <span class="menu-link__label">{{ title }}</span>
    </div>
  </a>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { RouterLink } from "vue-router";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

export default defineComponent({
  name: "MenuLink",
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
    const isActive = computed(() => {
      return router.currentRoute.value.path.indexOf(props.link) === 0 && props.link !== '/';
    });

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
      RouterLink,
      openWebPage,
      isActive,
      ariaLabel,
    };
  },
});
</script>

<style scoped lang="scss">

.menu-link {
  display: block;
  padding: 4px 8px;
  margin: 1px 5px;
  border-radius: 0;
  border: 1px solid transparent;
  text-decoration: none;
  cursor: pointer;
  color: var(--o2-sidebar-icon-color-default);
  background: transparent;
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
  will-change: transform;
  transform: translateZ(0);

  &--active {
    background: var(--o2-sidebar-nav-active-bg);
    color: var(--o2-sidebar-icon-color);
    border-color: rgba(255, 255, 255, 0.18);

    .menu-link__icon,
    .menu-link__label {
      color: var(--o2-sidebar-icon-color);
    }
  }

  &:not(.menu-link--active):hover {
    background: var(--o2-sidebar-nav-hover-bg);
    color: var(--o2-sidebar-icon-color);

    .menu-link__icon {
      transform: scale(1.12);
      transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .menu-link__icon,
    .menu-link__label {
      color: var(--o2-sidebar-icon-color);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--o2-sidebar-indicator, rgba(255, 255, 255, 0.5));
    outline-offset: 2px;
  }
}

.menu-link__section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 40px;
}

.menu-link__icon {
  padding: 4px;
  color: inherit;
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);

  // q-icon renders as <i> — keep sizing
  font-size: 1.3rem;
  width: 1.3rem;
  height: 1.3rem;
}

.menu-link__label {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.02em;
  color: inherit;
  text-align: center;
  display: block;
}

// Badge
.icon-wrapper {
  position: relative;
  display: inline-block;
}

.menu-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: linear-gradient(135deg, #ef4444 0%, #ec4899 100%);
  border: 2px solid rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 4px 8px rgba(239, 68, 68, 0.5);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  z-index: 1;
  will-change: opacity;
  transform: translateZ(0);
}
</style>
