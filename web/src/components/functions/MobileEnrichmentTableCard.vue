<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-enrichment-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-enrichment-card"
      :data-tone="badge.tone"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Enrichment table ${row.name}`"
    >
      <div class="mobile-enrichment-card__row">
        <q-icon
          name="table_chart"
          size="18px"
          class="mobile-enrichment-card__icon"
        />
        <span class="mobile-enrichment-card__title" :title="row.name">
          {{ row.name }}
        </span>
        <span
          class="mobile-enrichment-card__badge"
          :class="`mobile-enrichment-card__badge--${badge.tone}`"
        >
          {{ badge.label }}
        </span>
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-enrichment-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 200px">
              <q-item
                v-if="canExploreOrSchema"
                clickable
                v-close-popup
                @click="$emit('explore', row)"
              >
                <q-item-section avatar><q-icon name="search" /></q-item-section>
                <q-item-section>{{ t("common.explore") }}</q-item-section>
              </q-item>
              <q-item
                v-if="canExploreOrSchema"
                clickable
                v-close-popup
                @click="$emit('schema', row)"
              >
                <q-item-section avatar><q-icon name="list_alt" /></q-item-section>
                <q-item-section>{{ t("common.schema") }}</q-item-section>
              </q-item>
              <q-item
                v-if="canEdit"
                clickable
                v-close-popup
                @click="$emit('edit', row)"
              >
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-separator v-if="canExploreOrSchema || canEdit" />
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
      <div v-if="metaLine" class="mobile-enrichment-card__meta">
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

type Tone = "file" | "url" | "ok" | "warn" | "err" | "pending";

export default defineComponent({
  name: "MobileEnrichmentTableCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "explore", "schema", "edit", "delete"],
  setup(props) {
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    // URL-backed enrichment tables run async ingestion jobs whose state lives
    // in row.aggregateStatus: "completed" | "processing" | "pending" | "failed".
    // File-uploaded tables have no urlJobs and are always ready. The gating
    // below mirrors the desktop row-slot predicates in EnrichmentTableList.vue:
    // explore/schema need a ready table; edit is also available after failure
    // so the user can fix the source URL; delete is always allowed.
    const hasUrlJobs = computed(
      () => Array.isArray(props.row.urlJobs) && props.row.urlJobs.length > 0,
    );
    const canExploreOrSchema = computed(
      () => !hasUrlJobs.value || props.row.aggregateStatus === "completed",
    );
    const canEdit = computed(
      () =>
        !hasUrlJobs.value ||
        props.row.aggregateStatus === "completed" ||
        props.row.aggregateStatus === "failed",
    );
    const badge = computed<{ label: string; tone: Tone }>(() => {
      if (!hasUrlJobs.value) return { label: "file", tone: "file" };
      const status = props.row.aggregateStatus;
      if (status === "completed") return { label: "url · ok", tone: "ok" };
      if (status === "processing")
        return { label: "url · syncing", tone: "pending" };
      if (status === "failed") return { label: "url · failed", tone: "err" };
      if (status === "pending") return { label: "url · pending", tone: "pending" };
      return { label: "url", tone: "url" };
    });
    const metaLine = computed(() => {
      const bits: string[] = [];
      if (props.row.doc_num) bits.push(`${props.row.doc_num} docs`);
      if (props.row.storage_size && props.row.storage_size !== "0 MB") {
        bits.push(String(props.row.storage_size));
      }
      return bits.join(" · ");
    });
    return {
      t,
      moreIcon: outlinedMoreVert,
      canExploreOrSchema,
      canEdit,
      badge,
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

.mobile-enrichment-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-enrichment-card {
  @include mobile-card-accent("enrich-accent");
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  padding: 10px 12px 10px 15px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 150ms ease,
    transform 120ms ease;

  &[data-tone="file"],
  &[data-tone="url"] { --enrich-accent: var(--o2-primary-btn-bg); }
  &[data-tone="ok"] { --enrich-accent: var(--q-positive, #21ba45); }
  &[data-tone="warn"],
  &[data-tone="pending"] { --enrich-accent: var(--q-warning, #f2c037); }
  &[data-tone="err"] { --enrich-accent: var(--q-negative, #c10015); }

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

    &--file,
    &--url {
      color: var(--o2-primary-btn-bg);
      background: color-mix(in srgb, var(--o2-primary-btn-bg) 12%, transparent);
    }

    &--ok {
      color: var(--q-positive, #21ba45);
      background: color-mix(in srgb, var(--q-positive, #21ba45) 14%, transparent);
    }

    &--warn,
    &--pending {
      color: var(--q-warning, #f2c037);
      background: color-mix(in srgb, var(--q-warning, #f2c037) 16%, transparent);
    }

    &--err {
      color: var(--q-negative, #c10015);
      background: color-mix(in srgb, var(--q-negative, #c10015) 14%, transparent);
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
