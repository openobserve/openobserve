<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-stream-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-stream-card"
      :data-tone="streamTypeTone"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Stream ${row.name}`"
    >
      <div class="mobile-stream-card__row">
        <q-icon
          name="storage"
          size="18px"
          class="mobile-stream-card__icon"
        />
        <span class="mobile-stream-card__title" :title="row.name">
          {{ row.name }}
        </span>
        <span
          v-if="streamTypeLabel"
          class="mobile-stream-card__badge"
          :class="`mobile-stream-card__badge--${streamTypeTone}`"
        >
          {{ streamTypeLabel }}
        </span>
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-stream-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="$emit('explore', row)">
                <q-item-section avatar><q-icon name="search" /></q-item-section>
                <q-item-section>{{ t("common.explore") }}</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="$emit('schema', row)">
                <q-item-section avatar
                  ><q-icon name="list_alt"
                /></q-item-section>
                <q-item-section>{{ t("common.schema") }}</q-item-section>
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
      <div v-if="metaLine" class="mobile-stream-card__meta">
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

type Tone = "logs" | "metrics" | "traces" | "metadata" | "enrichment";

export default defineComponent({
  name: "MobileStreamCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    showDocCount: {
      type: Boolean,
      default: true,
    },
  },
  emits: ["click", "explore", "schema", "delete"],
  setup(props) {
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    const streamTypeLabel = computed(() => {
      const raw = (props.row.stream_type || "").toString();
      return raw ? raw.replace(/_/g, " ") : "";
    });
    const streamTypeTone = computed<Tone>(() => {
      const raw = (props.row.stream_type || "").toString();
      if (raw === "metrics") return "metrics";
      if (raw === "traces") return "traces";
      if (raw === "metadata") return "metadata";
      if (raw === "enrichment_tables") return "enrichment";
      return "logs";
    });
    // Backend returns storage strings like "0.0014781951904296875 MB" for
    // tiny streams. Desktop q-table truncates visually via column width; on
    // mobile the whole float wraps and looks broken, so round the numeric
    // prefix to 2 decimals.
    const trimSize = (raw: unknown): string => {
      const s = String(raw ?? "").trim();
      const m = s.match(/^(-?\d+(?:\.\d+)?)(\s*\S.*)?$/);
      if (!m) return s;
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return s;
      const rounded = Math.abs(n) < 0.01 && n !== 0 ? n.toFixed(3) : n.toFixed(2);
      return `${parseFloat(rounded)}${m[2] ?? ""}`;
    };
    const metaLine = computed(() => {
      const bits: string[] = [];
      if (props.showDocCount && props.row.doc_num && props.row.doc_num !== "--") {
        bits.push(`${props.row.doc_num} docs`);
      }
      if (props.row.storage_size && props.row.storage_size !== "-- MB") {
        bits.push(trimSize(props.row.storage_size));
      }
      if (
        props.row.compressed_size &&
        props.row.compressed_size !== "-- MB" &&
        props.row.compressed_size !== "0 MB"
      ) {
        bits.push(`${trimSize(props.row.compressed_size)} compressed`);
      }
      return bits.join(" · ");
    });
    return {
      t,
      moreIcon: outlinedMoreVert,
      streamTypeLabel,
      streamTypeTone,
      metaLine,
      vibrate,
    };
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

.mobile-stream-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-stream-card {
  @include mobile-card-accent("stream-accent");
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  padding: 10px 12px 10px 15px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 150ms ease,
    transform 120ms ease;

  // Left-edge accent stripe keyed to stream type — reinforces the badge
  // color so a list of mixed-type streams is scannable at a glance.

  &[data-tone="logs"] { --stream-accent: var(--o2-primary-btn-bg); }
  &[data-tone="metrics"] { --stream-accent: #0d8a6a; }
  &[data-tone="traces"] { --stream-accent: #b26a00; }
  &[data-tone="metadata"] { --stream-accent: #5c5f66; }
  &[data-tone="enrichment"] { --stream-accent: #7a3ea1; }

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
    border-radius: 999px;
    padding: 2px 8px;
    flex-shrink: 0;

    &--logs {
      color: var(--o2-primary-btn-bg);
      background: color-mix(in srgb, var(--o2-primary-btn-bg) 12%, transparent);
    }

    &--metrics {
      color: #0d8a6a;
      background: color-mix(in srgb, #0d8a6a 14%, transparent);
    }

    &--traces {
      color: #b26a00;
      background: color-mix(in srgb, #b26a00 14%, transparent);
    }

    &--metadata {
      color: #5c5f66;
      background: color-mix(in srgb, #5c5f66 14%, transparent);
    }

    &--enrichment {
      color: #7a3ea1;
      background: color-mix(in srgb, #7a3ea1 14%, transparent);
    }
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
    font-variant-numeric: tabular-nums;
  }
}
</style>
