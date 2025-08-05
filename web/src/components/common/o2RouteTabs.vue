<template>
  <q-tabs 
    :model-value="modelValue" 
    @update:model-value="$emit('update:modelValue', $event)"
    horizontal 
    align="left"
    class="o2-route-tabs"
    dense
    :class="store.state.theme == 'dark' ? 'o2-route-tabs-dark' : 'o2-route-tabs-light'"
  >
    <q-route-tab
      v-for="tab in tabs"
      :key="tab.name"
      :default="tab.default"
      :name="tab.name"
      :to="{
        name: tab.routeName || tab.name,
        query: {
          org_identifier: organizationIdentifier,
        },
      }"
      :label="tab.label"
      content-class="tab_content"
    />
  </q-tabs>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';

export interface Tab {
  name: string;
  routeName?: string;
  label: string;
  default?: boolean;
}

const props = defineProps<{
  modelValue: string;
  organizationIdentifier: string;
  tabs: Tab[];
}>();

defineEmits(['update:modelValue']);

const store = useStore();

</script>

<style lang="scss">
.o2-route-tabs {
  margin: 0.5rem 1rem 0rem 1rem;
  padding: 0px !important;

    .q-tab {
      justify-content: flex-start;
      padding: 0 0.6rem 0 0.6rem;
      margin-bottom: 0.5rem;
      text-transform: capitalize;

      &__content.tab_content {
        .q-tab {
          &__icon + &__label {
            padding-left: 0.875rem;
            font-weight: 600;
          }
        }
      }

      .q-tab__label{
        font-size: 13px !important;
      }
      .q-tab__content{
        padding: 0px !important;
        height: 32px !important;
      }

    }

}

.o2-route-tabs-light {
  .q-tab {
    &:hover{
      background-color: #EBECF0;
    }
    &--active {
      .q-tab__indicator{
        color: #826AF9;
      }
    }
  }

}

.o2-route-tabs-dark {
  .q-tab {
    &:hover{
      background-color: #393B40;
    }
    &--active {
      .q-tab__indicator{
        color: #9E86FF;
      }
    }
  }
}
</style>
<style lang="scss" scoped>
    .q-tabs--dense .q-tab{
        min-height: 32px !important;
        height: 32px !important;
      }
</style> 