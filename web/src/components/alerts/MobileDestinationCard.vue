<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-destination-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-destination-card"
      :data-tone="(row.type || 'http').toLowerCase()"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Destination ${row.name}`"
    >
      <div class="mobile-destination-card__row">
        <q-icon
          :name="iconName"
          size="18px"
          class="mobile-destination-card__icon"
        />
        <span class="mobile-destination-card__title" :title="row.name">
          {{ row.name }}
        </span>
        <span
          v-if="typeLabel"
          class="mobile-destination-card__badge"
        >
          {{ typeLabel }}
        </span>
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-destination-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="$emit('edit', row)">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="$emit('export', row)">
                <q-item-section avatar
                  ><q-icon name="download"
                /></q-item-section>
                <q-item-section>{{ t("common.export") }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item
                clickable
                v-close-popup
                class="text-negative"
                @click="$emit('delete', row)"
              >
                <q-item-section avatar><q-icon name="delete" /></q-item-section>
                <q-item-section>{{ t("common.delete") }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>
      <div v-if="metaLine" class="mobile-destination-card__meta">
        {{ metaLine }}
      </div>
    </div>
  </q-slide-item>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedMoreVert } from "@quasar/extras/material-icons-outlined";
import { useHaptics } from "@/composables/useHaptics";

export default defineComponent({
  name: "MobileDestinationCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    typeLabel: {
      type: String,
      default: "",
    },
  },
  emits: ["click", "edit", "export", "delete"],
  setup(props) {
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    const iconName = computed(() => {
      switch ((props.row.type || "").toLowerCase()) {
        case "email":
          return "mail";
        case "action":
          return "bolt";
        case "http":
        default:
          return "send";
      }
    });
    const metaLine = computed(() => {
      const bits: string[] = [];
      if (props.row.method) bits.push(String(props.row.method).toUpperCase());
      if (props.row.url) {
        const url = String(props.row.url);
        bits.push(url.length > 48 ? `${url.slice(0, 48)}…` : url);
      } else if (props.row.emails) {
        const list = Array.isArray(props.row.emails)
          ? props.row.emails.join(", ")
          : String(props.row.emails);
        bits.push(list.length > 48 ? `${list.slice(0, 48)}…` : list);
      }
      return bits.join(" · ");
    });
    return { t, moreIcon: outlinedMoreVert, iconName, metaLine, vibrate };
  },
  methods: {
    onSwipeRight({ reset }: { reset: () => void }) {
      this.vibrate("impact");
      this.$emit("delete", this.row);
      reset();
    },
  },
});
</script>

<style scoped lang="scss">
@import "@/styles/mobile-cards";

.mobile-destination-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-destination-card {
  @include mobile-card-accent("dest-accent");
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  padding: 10px 12px 10px 15px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 150ms ease,
    transform 120ms ease;

  // Unknown destination types (beyond http/email/action) fall through to the
  // mixin's default `--o2-primary` — matches the "http" look, which is fine
  // as a conservative default for unrecognized rows.
  &[data-tone="http"] { --dest-accent: var(--o2-primary-btn-bg); }
  &[data-tone="email"] { --dest-accent: #0d8a6a; }
  &[data-tone="action"] { --dest-accent: #b26a00; }

  &:active {
    background: var(--o2-hover-accent);
    transform: scale(0.995);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__icon {
    color: var(--o2-primary-btn-bg);
    flex-shrink: 0;
  }

  &__title {
    font-weight: 600;
    font-size: 14px;
    color: var(--o2-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  &__badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--o2-primary-btn-bg);
    background: color-mix(in srgb, var(--o2-primary-btn-bg) 12%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
    flex-shrink: 0;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__meta {
    margin: 4px 0 0 28px;
    font-size: 12px;
    color: var(--o2-text-secondary);
    font-family:
      ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono",
      monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
