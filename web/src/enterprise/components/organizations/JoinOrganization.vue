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
  <q-card class="full-height">
    <q-card-section class="q-px-md q-py-md">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 text-bold">
            {{ t("organization.invite") }}
          </div>
          <div class="text-bold captionText">
            ({{ organizationData.name }}: ID#{{ organizationData.id }})
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup="true"
            round
            flat
            icon="img:/src/assets/images/common/close_icon.svg"
            @click="router.replace({ name: 'organizations' })"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />

    <q-card-section class="q-w-md q-mx-lg">
      <ListAssociatedMembers
        :key="associatedMembers.length"
        :data="associatedMembers"
      ></ListAssociatedMembers>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

import organizationsService from "@/services/organizations";
import ListAssociatedMembers from "./ListAssociatedMembers.vue";

const defaultValue: any = () => {
  return {
    id: "",
    name: "",
    role: "",
    identifier: "",
    member_lists: [],
  };
};

export default defineComponent({
  name: "ComponentAddUpdateUser",
  components: { ListAssociatedMembers },
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  emits: ["update:modelValue", "updated", "finish"],
  setup() {
    const store: any = useStore();
    const router = useRouter();
    const organizationData: any = ref(defaultValue());
    const associatedMembers: any = ref([]);
    const { t } = useI18n();
    const $q = useQuasar();

    return {
      t,
      organizationData,
      store,
      associatedMembers,
      router,
    };
  },
  created() {
    if (this.modelValue && this.modelValue.id) {
      this.organizationData = {
        id: this.modelValue.id,
        name: this.modelValue.name,
        role: this.modelValue.role,
        identifier: this.modelValue.identifier,
        member_lists: this.modelValue.member_lists,
      };
    }

    this.getAssociatedMembers(this.modelValue?.identifier);
  },
  methods: {
    getAssociatedMembers(identifier: string) {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait while loading organizations...",
      });

      organizationsService
        .get_associated_members(identifier)
        .then((res) => {
          let counter = 1;
          this.associatedMembers = res.data.data.map(
            (data: { email: any; status: any }) => {
              return {
                "#": counter++,
                email: data.email,
                status: data.status,
                owner:
                  data.email == this.store.state.userInfo.email ? true : false,
              };
            }
          );

          dismiss();
        })
        .catch((error: any) => console.log(error));
    },
  },
});
</script>

<style lang="scss" scoped>
.captionText {
  font-size: 0.625rem;
}
</style>
