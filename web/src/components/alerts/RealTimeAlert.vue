<!-- Copyright 2023 OpenObserve Inc.

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
  <div>


    <!-- first section -->

    <div class= " q-mt-sm tw-w-full row alert-setup-container " style=" margin-left: 8px;">
    <AlertsContainer 
      name="Alert Settings"
      v-model:is-expanded="expandState.thresholds"
      label="Alert Settings"
      subLabel="Set your alert rules and choose how you'd like to be notified."
      icon="tune"
      class="tw-mt-1 tw-w-full col-12"
      @update:is-expanded="()=>emits('update:expandState', expandState)"
    />
    <div v-if="expandState.thresholds" class="q-px-lg">
    <div class="col-12 flex justify-start items-center q-mt-xs">
              <div
                class="q-py-sm showLabelOnTop text-bold text-h7 q-pb-md flex items-center"
                data-test="add-alert-delay-title"
                style="width: 190px"
              >
                {{ t("alerts.silenceNotification") + " *" }}
                <q-icon
                  :name="outlinedInfo"
                  size="17px"
                  class="q-ml-xs cursor-pointer"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                  "
                >
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                  >
                    <span style="font-size: 14px">
                      If the alert triggers then how long should it wait before
                      sending another notification.
                      <br />
                      e.g. if the alert triggers at 4:00 PM and the silence
                      notification is set to 10 minutes then it will not send
                      another notification until 4:10 PM even if the alert is
                      still after 1 minute. This is to avoid spamming the user
                      with notifications.</span
                    >
                  </q-tooltip>
                </q-icon>
              </div>
              <div style="min-height: 58px">
                <div class="col-8 row justify-left align-center q-gutter-sm">
                  <div
                    class="flex items-center"
                    style="border: 1px solid rgba(0, 0, 0, 0.05)"
                  >
                    <div
                      data-test="add-alert-delay-input"
                      style="width: 87px; margin-left: 0 !important"
                      class="silence-notification-input"
                    >
                      <q-input
                        v-model="triggerData.silence"
                        type="number"
                        dense
                        filled
                        min="0"
                        style="background: none"
                        @update:model-value="updateTrigger"
                      />
                    </div>
                    <div
                      data-test="add-alert-delay-unit"
                      style="
                        min-width: 90px;
                        margin-left: 0 !important;
                        background: #f2f2f2;
                        height: 40px;
                      "
                      :class="
                        store.state.theme === 'dark'
                          ? 'bg-grey-10'
                          : 'bg-grey-2'
                      "
                      :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"

                      class="flex justify-center items-center"
                    >
                      {{ t("alerts.minutes") }}
                    </div>
                  </div>
                </div>
                <div
                  data-test="add-alert-delay-error"
                  v-if="triggerData.silence < 0 || triggerData.silence === undefined || triggerData.silence === null"
                  class="text-red-8 q-pt-xs q-field--error"
                  style="font-size: 11px; line-height: 12px"
                >
                  Field is required!
                </div>
              </div>
    </div>
    <div class="o2-input flex justify-start items-start q-mt-sm">
              <div
                data-test="add-alert-destination-title"
                class="text-bold q-pb-sm"
                style="width: 190px"
              >
                {{ t("alerts.destination") + " *" }}
              </div>
              <div data-test="add-alert-destination-select">
                <q-select
                  ref="destinationSelectRef"
                  v-model="destinations"
                  :options="filteredDestinations"
                  :input-debounce="300"
                  color="input-border"
                  class="no-case"
                  :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                  stack-label
                  outlined
                  filled
                  dense
                  multiple
                  use-input
                  fill-input
                  :rules="[(val: any) =>{
                    return val.length > 0 || 'Field is required!'
                  }]"
                  :required="true"
                  style="width: 200px"
                  @filter="filterDestinations"
                  @update:model-value="updateDestinations"
                  @popup-show="isDestinationDropdownOpen = true"
                  @popup-hide="isDestinationDropdownOpen = false"
                >
                  <q-tooltip
                    v-if="!isDestinationDropdownOpen && destinations?.length > 0"
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[0, 8]"
                    max-width="300px"
                  >
                    {{ destinations }}
                  </q-tooltip>
                  <template v-slot:option="option">
                    <q-list dense>
                      <q-item
                        tag="label"
                        :data-test="`add-alert-destination-${option.opt}-select-item`"
                      >
                        <q-item-section avatar>
                          <q-checkbox
                            size="xs"
                            dense
                            v-model="destinations"
                            :val="option.opt"
                            @update:model-value="updateDestinations"
                          />
                        </q-item-section>
                        <q-item-section>
                          <q-item-label class="ellipsis"
                            >{{ option.opt }}
                          </q-item-label>
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </template>
                </q-select>
              </div>
              <div class="q-pl-sm">
                <q-btn
                  data-test="create-destination-btn"
                  icon="refresh"
                  title="Refresh latest Destinations"
                  class="text-bold no-border"
                  no-caps
                  flat
                  dense
                  @click="$emit('refresh:destinations')"
                />
              </div>
              <div class="q-pl-sm">
                <q-btn
                  data-test="create-destination-btn"
                  label="Add New Destination"
                  class="text-bold no-border"
                  color="primary"
                  no-caps
                  @click="routeToCreateDestination"
                />
              </div>
    </div>
    </div>

   </div>

   <!-- second section -->

   <div class=" q-mt-md tw-w-full row alert-setup-container " style=" margin-left: 8px;">
    <AlertsContainer 
      name="query"
      v-model:is-expanded="expandState.realTimeMode"
      label="Conditions"
      :image="conditionsImage"
      subLabel="What should trigger the alert."
      class="tw-mt-1 tw-w-full col-12    "
      @update:is-expanded="()=>emits('update:expandState', expandState)"
    />
    <FilterGroup v-if="expandState.realTimeMode" :stream-fields="columns" :group="inputData" :depth="0" @add-condition="updateGroup" @add-group="updateGroup" @remove-group="removeConditionGroup" @input:update="(name, field) => emits('input:update', name, field)" />
    </div>

  </div>
</template>

<script lang="ts" setup>
import FieldsInput from "./FieldsInput.vue";
import AlertsContainer from "./AlertsContainer.vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useStore } from "vuex";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import { useRouter } from "vue-router";
import FilterGroup from "./FilterGroup.vue";
import { getImageURL } from "@/utils/zincutils";

const { t } = useI18n();

const store = useStore();

const router = useRouter();

const props = defineProps(["columns", "conditions","enableNewValueMode", "expandState", "trigger", "destinations", "formattedDestinations"]);

const emits = defineEmits(["field:add", "field:remove", "input:update", "update:expandState", "update:trigger", "refresh:destinations", "update:destinations", "update:group", "remove:group"]);

const triggerData = ref(props.trigger);

const destinations = ref(props.destinations);


const filteredDestinations = ref(props.formattedDestinations)

const inputData = ref(props.conditions);

const destinationSelectRef = ref(null);

const isDestinationDropdownOpen = ref(false);

watch(()=> destinations.value, (newVal, oldVal)=>{
  //check if the newVal length is greater than oldVal length
  //then if any filter is applied then clear the input
  if(newVal.length > oldVal.length){
    //have to clear the input
    //this runs every time if users types or not because setting the previous value ('') to ('') is same
    destinationSelectRef.value.updateInputValue('');
  }
})


const updateTrigger = () => {
  emits("update:trigger", triggerData.value);
};

const addField = (field: any) => {
  emits("field:add", field);
  emits("input:update", "conditions", field);
};

const removeField = (field: any) => {
  emits("field:remove", field);
  emits("input:update", "conditions", field);
};
const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

const updateDestinations = (destinations: any[]) => {
  emits("update:destinations", destinations);
};


// Method to handle the emitted changes and update the structure
function updateGroup(updatedGroup:any) {
    emits('update:group', updatedGroup)
  }

  const removeConditionGroup = (targetGroupId: string, currentGroup: any = inputData.value) => {
    emits('remove:group', targetGroupId)
  };
  const conditionsImage = computed(() => {
    if(store.state.theme === 'dark'){
      return getImageURL('images/alerts/conditions_image.svg')
    }
    else{
      return getImageURL('images/alerts/conditions_image_light.svg')
    }
  })

  const filterDestinations = (val: string, update: Function) => {
    if (val === "") {
      update(() => {
        filteredDestinations.value = [...props.formattedDestinations];
      });
      return;
    }

    update(() => {
      const needle = val.toLowerCase();
      filteredDestinations.value = props.formattedDestinations.filter(
        (destination: string) => destination.toLowerCase().includes(needle)
      );
    });
  };
</script>

<style lang="scss" scoped></style>
