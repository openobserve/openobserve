<template>
  <q-tabs
    :data-test="dataTest"
    v-model="activeTab"
    indicator-color="transparent"
    inline-label
    :vertical="direction === 'vertical'"
    class="q-mx-xs o2-route-tabs"
    @update:model-value="handleTabChange"
  >
    <template v-for="tab in (tabs as any)" :key="tab.name">
      <q-route-tab
        :data-test="tab.dataTest"
        :name="tab.name"
        :to="tab.to"
        :label="tab.label"
        :content-class="tab.class"
      />
    </template>
  </q-tabs>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps({
  tabs: {
    type: Array,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
  dataTest: {
    type: String,
    required: true,
  },
  direction: {
    type: String,
    default: "vertical",
  },
});

const emits = defineEmits(["update:activeTab"]);

const activeTab = ref(props.activeTab);

const handleTabChange = (tab: string) => {
  activeTab.value = tab;
  emits("update:activeTab", tab);
};
</script>

<style lang="scss">
.o2-route-tabs {
  &.q-tabs {
    &--vertical {
      padding: 16px 8px 0 8px;
      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        text-transform: capitalize;
        min-height: 40px !important;
        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $accent;
          color: black;
        }
      }
    }
  }
}
</style>
