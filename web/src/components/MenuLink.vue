<template>
  <q-item
    v-if="display == true"
    v-ripple
    :to="{ path: link, exact: false }"
    clickable
    :class="{ 'ql-item-mini': mini }"
  >
    <q-tooltip
      v-if="mini"
      anchor="center right"
      self="center left"
      :offset="[10, 10]"
    >
      {{ title }}
    </q-tooltip>
    <q-item-section v-if="icon" avatar>
      <q-icon :name="icon" />
    </q-item-section>

    <q-item-section v-if="!mini">
      {{ title }}
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";

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

    mini: {
      type: Boolean,
      default: false,
    },

    display: {
      type: Boolean,
      default: true,
    },
  },
});
</script>

<style scoped lang="scss">
.q-item {
  padding: 8px 17px;
  margin: 0 24px;
  border-radius: 6px;

  /* Overriding default height */
  min-height: 40px;

  &.q-router-link--active {
    background-color: #5960b2;
    color: white;

    &::before {
      content: " ";
      width: 10px;
      height: 40px;
      position: absolute;
      left: -30px;
      top: 0;
      background-color: inherit;
      border-radius: 6px;
    }
  }

  &.ql-item-mini {
    margin: 0 8px;

    &::before {
      display: none;
    }
  }
}

.q-item__section--avatar {
  margin: 0;
  padding: 0;
  min-width: 40px;
}
</style>
