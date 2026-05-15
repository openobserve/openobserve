<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-pipeline-card-slide"
    left-color="green"
    right-color="red"
    @left="onSwipeLeft"
    @right="onSwipeRight"
  >
    <template #left>
      <q-icon :name="row.enabled ? 'pause' : 'play_arrow'" />
      <span class="q-ml-xs">{{ row.enabled ? t("alerts.pause") : t("alerts.start") }}</span>
    </template>
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-pipeline-card"
      :class="{ 'mobile-pipeline-card--disabled': !row.enabled }"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Pipeline ${row.name}`"
    >
      <div class="mobile-pipeline-card__row">
        <div class="mobile-pipeline-card__title-wrap">
          <span
            class="mobile-pipeline-card__status-dot"
            :class="row.enabled ? 'is-on' : 'is-off'"
            :aria-label="row.enabled ? 'Enabled' : 'Paused'"
          />
          <span class="mobile-pipeline-card__title" :title="row.name">
            {{ row.name }}
          </span>
          <q-badge
            v-if="sourceType"
            :color="sourceType === 'scheduled' ? 'indigo' : 'teal'"
            :label="sourceType"
            outline
            class="mobile-pipeline-card__badge"
          />
        </div>
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-pipeline-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="$emit('toggle', row)">
                <q-item-section avatar>
                  <q-icon :name="row.enabled ? 'pause' : 'play_arrow'" />
                </q-item-section>
                <q-item-section>
                  {{ row.enabled ? t("alerts.pause") : t("alerts.start") }}
                </q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="$emit('edit', row)">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="$emit('export', row)">
                <q-item-section avatar>
                  <q-icon name="download" />
                </q-item-section>
                <q-item-section>{{ t("common.export") }}</q-item-section>
              </q-item>
              <q-item
                v-if="canBackfill"
                clickable
                v-close-popup
                @click="$emit('backfill', row)"
              >
                <q-item-section avatar>
                  <q-icon name="refresh" />
                </q-item-section>
                <q-item-section>{{ t("pipeline.createBackfill") }}</q-item-section>
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

      <div v-if="subtitle" class="mobile-pipeline-card__subtitle">
        {{ subtitle }}
      </div>

      <div class="mobile-pipeline-card__meta">
        <span v-if="row.stream_name" class="mobile-pipeline-card__meta-item">
          <q-icon name="cable" size="12px" />{{ row.stream_name }}
        </span>
        <span v-if="cadence" class="mobile-pipeline-card__meta-item">
          <q-icon name="schedule" size="12px" />{{ cadence }}
        </span>
        <span v-if="row.last_error" class="mobile-pipeline-card__meta-error">
          <q-icon name="error" size="12px" />Error
        </span>
        <span
          class="mobile-pipeline-card__state"
          :class="row.enabled ? 'is-on' : 'is-off'"
        >
          {{ row.enabled ? t("alerts.enabled") : t("alerts.paused") }}
        </span>
      </div>
    </div>
  </q-slide-item>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedMoreVert } from "@quasar/extras/material-icons-outlined";
import { useHaptics } from "@/composables/useHaptics";

export default defineComponent({
  name: "MobilePipelineCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    isEnterprise: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["click", "toggle", "edit", "export", "backfill", "delete"],
  setup(props) {
    const { t } = useI18n();
    const moreIcon = outlinedMoreVert;
    const { vibrate } = useHaptics();
    const sourceType = computed(
      () =>
        (props.row.type ||
          props.row.source?.source_type ||
          "") as string,
    );
    const subtitle = computed(() => {
      const parts: string[] = [];
      if (props.row.stream_type) parts.push(String(props.row.stream_type));
      if (sourceType.value) parts.push(String(sourceType.value));
      return parts.join(" · ");
    });
    const cadence = computed(() => {
      const f = props.row.frequency;
      if (f && f !== "--") return String(f);
      const p = props.row.period;
      if (p && p !== "--") return String(p);
      return "";
    });
    const canBackfill = computed(
      () =>
        props.isEnterprise &&
        (props.row.type === "scheduled" ||
          props.row.source?.source_type === "scheduled"),
    );
    return { t, moreIcon, sourceType, subtitle, cadence, canBackfill, vibrate };
  },
  methods: {
    onSwipeLeft({ reset }: { reset: () => void }) {
      this.vibrate("selection");
      this.$emit("toggle", this.row);
      reset();
    },
    onSwipeRight({ reset }: { reset: () => void }) {
      this.vibrate("impact");
      this.$emit("delete", this.row);
      reset();
    },
  },
});
</script>

<style scoped lang="scss">
.mobile-pipeline-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-pipeline-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 150ms ease,
    transform 120ms ease;

  &:active {
    background: var(--o2-hover-accent);
    transform: scale(0.995);
  }

  &--disabled {
    opacity: 0.65;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  &__status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;

    &.is-on {
      background: var(--o2-status-success-text);
      box-shadow: 0 0 0 3px rgba(33, 186, 69, 0.15);
    }
    &.is-off {
      background: var(--o2-text-muted);
    }
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
    flex-shrink: 0;
    font-size: 9px;
    text-transform: capitalize;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__subtitle {
    margin-top: 3px;
    margin-left: 16px;
    font-size: 11px;
    color: var(--o2-text-muted);
    text-transform: capitalize;
  }

  &__meta {
    margin-top: 8px;
    margin-left: 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: var(--o2-text-muted);
  }

  &__meta-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  &__meta-error {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: #c62828;
  }

  &__state {
    margin-left: auto;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    &.is-on {
      background: rgba(33, 186, 69, 0.12);
      color: var(--o2-status-success-text);
    }
    &.is-off {
      background: rgba(129, 133, 148, 0.12);
      color: var(--o2-text-muted);
    }
  }
}
</style>
