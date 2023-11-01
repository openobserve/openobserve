<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-item
    :data-test="`menu-link-${link}-item`"
    v-ripple="true"
    :to="
      !external
        ? {
            path: link,
            exact: false,
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          }
        : ''
    "
    clickable
    :class="{ 'ql-item-mini': mini, 'q-router-link--active': router.currentRoute.value.path.indexOf(link) == 0 && link != '/' }"
    :target="target"
    @click="external ? openWebPage(link) : ''"
  >
    <q-item-section v-if="icon" avatar>
      <q-icon :name="icon" />
    </q-item-section>
    <q-item-section v-else-if="iconComponent" avatar>
      <q-icon><component :is="iconComponent" /></q-icon>
    </q-item-section>

    <q-item-section>
      {{ title }}
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
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
  },
  setup() {
    const store = useStore();
    const router: any = useRouter();
    const openWebPage = (url: string) => {
      window.open(url, "_blank");
    };

    return {
      store,
      router,
      openWebPage,
    };
  },
});
</script>

<style scoped lang="scss">
.q-item {
  padding: 8px 8px;
  margin: 0 8px;
  border-radius: 6px;

  /* Overriding default height */
  min-height: 40px;

  &.q-router-link--active {
    background-color: $primary;
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
    margin: 0;

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
