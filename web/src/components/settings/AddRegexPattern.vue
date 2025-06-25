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
    <div
      class="q-pt-md"
      
      :class="[store.state.theme === 'dark' ? 'bg-dark add-regex-pattern-dark' : 'bg-white add-regex-pattern-light',
      ]"
          :style="{
            width: isFullScreen  ? '100vw' : store.state.isAiChatEnabled ? '70vw' : '40vw'
            }"
    >
      <div class="add-regex-pattern-header q-px-md tw-flex tw-items-center tw-justify-between">
        <div class="tw-flex tw-items-center tw-justify-between">
                <q-btn
                    data-test="add-stream-close-btn"
                    v-close-popup="true"
                    round
                    flat
                    icon="arrow_back"
                />
          <div class="add-regex-pattern-title" data-test="add-regex-pattern-title">
            {{ t("regex_patterns.create_regex_pattern") }}
          </div>
        </div>
        <div class="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <q-btn
            v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
            :ripple="false"
            @click="toggleAIChat"
            data-test="add-regex-pattern-open-close-ai-btn"
            no-caps
            :borderless="true"
            flat
            dense
            class="o2-button ai-hover-btn q-px-sm q-py-sm"
            :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
            style="border-radius: 100%;"
            @mouseenter="isHovered = true"
            @mouseleave="isHovered = false"
            >
            <div class="row items-center no-wrap tw-gap-2  ">
                <img  :src="getBtnLogo" class="header-icon ai-icon" />
            </div>
            </q-btn>
            <q-btn 
            icon="fullscreen" 
            size="14px" 
            dense 
            class="tw-cursor-pointer" 
            :class="store.state.theme === 'dark' ? 'tw-text-white' : ''"
            :color="isFullScreen ? 'primary' : undefined"
            @click="() => isFullScreen = !isFullScreen" 
          />
          <q-btn
            data-test="add-regex-pattern-close-btn"
            v-close-popup="true"
            round
            flat
            icon="close"
        />
        </div>

      </div>
      <q-separator class="q-mb-md q-mt-sm" />
      <!-- form inputs starts here -->
       <div class="tw-flex tw-w-[100%]">
            <div class=" "
            :class="store.state.isAiChatEnabled ? isFullScreen ? 'tw-w-[85%] q-pl-sm' : 'tw-w-[65%] q-pl-sm' : 'tw-w-[100%] q-px-md'"
            >
            <q-form @submit="saveRegexPattern" class="tw-flex tw-flex-col tw-gap-4" style="overflow: auto; height: calc(100vh - 150px);">
                <div class="tw-flex tw-flex-col">
                    <div data-test="add-regex-pattern-name-input">
                <q-input
                    v-bind:readonly="isEdit"
                    v-bind:disable="isEdit"
                    v-model="regexPatternInputs.name"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    outlined
                    filled
                    tabindex="0"
                    style="min-width: 480px;"
                    placeholder="Enter Pattern Name*"
                    class="add-regex-pattern-name-input"
                    @update:model-value='updatePatternInputs'
                    :rules="[val => val !== '' || '* Name is required']"
                />
                </div>
                <div data-test="add-regex-pattern-description-input" class="tw-mb-4">
                <q-input
                    v-model="regexPatternInputs.description"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    outlined
                    filled
                    dense
                    tabindex="0"
                    placeholder="Enter Pattern Description"
                    style="min-width: 480px"
                    class="add-regex-pattern-description-input"
                />
                </div>
                <div class="regex-pattern-input-container">
                    <FullViewContainer
                        style="padding: 12px 8px;"
                        :style="{
                            'background-color': store.state.theme === 'dark' ? '#2A2929' : '#fafafa',
                            'border': store.state.theme === 'dark' ? '' : '1px solid #E6E6E6'
                        }"
                        name="query"
                        v-model:is-expanded="expandState.regexPattern"
                        label="Regular Expression*"
                        class="tw-mt-1 tw-py-md"
                        labelClass="tw-py-md"
                        :o2AIicon="true"
                        @toggleO2Ai="toggleAIChat"
                    />
                    <div v-if="expandState.regexPattern" class="regex-pattern-input">
                        <q-input
                        data-test="regex-pattern-input-textarea"
                        v-model="regexPatternInputs.pattern"
                        color="input-border"
                        bg-color="input-bg"
                        class="regex-pattern-input"
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-pattern-input' : 'light-mode-regex-pattern-input'"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        style="width: 100%; resize: none;"
                        type="textarea"
                        placeholder="Eg. \d....\d "
                        rows="5"
                        @update:model-value='updatePatternInputs'
                        :rules="[val => val !== '' || '* Pattern is required']"
                        />
                    </div>
                </div>
                <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                        style="padding: 12px 8px; "
                        :style="{
                            'background-color': store.state.theme === 'dark' ? '#2A2929' : '#fafafa',
                            'border': store.state.theme === 'dark' ? '' : '1px solid #E6E6E6'
                        }"
                        name="query"
                        v-model:is-expanded="expandState.regexTestString"
                        label="Test String"
                        class="tw-mt-1 tw-py-md"
                        labelClass="tw-py-md"
                        :o2AIicon="false"
                    />
                    <div v-if="expandState.regexTestString" class="regex-pattern-input">
                        <q-input
                        data-test="regex-pattern-test-string-textarea"
                        v-model="testString"
                        color="input-border"
                        bg-color="input-bg"
                        class="regex-test-string-input"
                        :class="[store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input',
                            isPatternValid ? 'is-pattern-valid' : 'is-pattern-invalid'
                        ]"
                        
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        style="width: 100%; resize: none; "
                        type="textarea"
                        placeholder="Eg. yhk1abc2"
                        rows="5"
                        @update:model-value='updatePatternInputs'
                        />
                    </div>
                </div>
                </div>

            </q-form>
            <div class="flex justify-end q-mt-sm" style="position: sticky; bottom: 0; right: 0;">
                <q-btn
                    v-close-popup="true"
                    data-test="add-stream-cancel-btn"
                    :label="t('regex_patterns.cancel')"
                    class="q-my-sm text-bold q-mr-md"
                    padding="sm md"
                    no-caps
                    style="border: 1px solid #E6E6E6;"
                />
                <q-btn
                    data-test="save-stream-btn"
                    :label="isSaving ? 'Saving...' : t('regex_patterns.create_close')"
                    class="q-my-sm text-bold no-border"
                    :style="{
                        'background-color': isFormEmpty ? '#aeaeae' : '#5ca380',
                        'color': isFormEmpty  ? store.state.theme === 'dark' ? '#ffffff' : '#000000' : '#ffffff'
                        }"
                    padding="sm xl"
                    type="submit"
                    no-caps
                    @click="saveRegexPattern"
                    :disable="isFormEmpty || isSaving"
                />
            </div>
            </div>
            <div  class="q-ml-sm" v-if="store.state.isAiChatEnabled " style="width:35%; max-width: 100%; min-width: 75px; height: calc(100vh - 90px) !important;  " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
              <O2AIChat style="height: calc(100vh - 90px) !important;" :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" />

            </div>
       </div>

    </div>
    
  </template>
  
<script lang="ts">
    import { defineComponent, onMounted, ref, watch } from "vue";
    import { useI18n } from "vue-i18n";
    import type { Ref } from "vue";
    import { useStore } from "vuex";
    import { computed } from "vue";
    import { debounce, useQuasar } from "quasar";
    import useStreams from "@/composables/useStreams";
    import config from "@/aws-exports";
    import { getImageURL } from "@/utils/zincutils";
    import FullViewContainer from "../functions/FullViewContainer.vue";
    import regexPatternService from "@/services/regex_pattern";
    import O2AIChat from "@/components/O2AIChat.vue";
    export default defineComponent({
        name: "AddRegexPattern",
        props: {
            data: {
                type: Object,
                default: () => ({}),
            },
            isEdit: {
                type: Boolean,
                default: false,
            },
        },
        emit: ["close", "update:list"],
        components: {
            FullViewContainer,
            O2AIChat
        },
        setup(props, {emit}) {
            const { t } = useI18n();

            const store = useStore();

            const q = useQuasar();

            const isHovered = ref(false);

            const isFullScreen = ref(false);

            const testString = ref("");

            const isFormEmpty = ref(true);

            const isPatternValid = ref(false);

            onMounted(()=>{
                if(props.isEdit){
                    regexPatternInputs.value.name = props.data.name;
                    regexPatternInputs.value.pattern = props.data.pattern;
                }
            })

            const isSaving = ref(false);
            const regexPatternInputs: any = ref({
                name: "",
                pattern: "",
                description: "",//this is optional we dont consider it anyway
            });

            const expandState = ref({
                regexPattern: true,
                regexTestString: true,
            });



            const getBtnLogo = computed(() => {
                if (isHovered.value || store.state.isAiChatEnabled) {
                    return getImageURL('images/common/ai_icon_dark.svg')
                }
                return store.state.theme === 'dark'
                    ? getImageURL('images/common/ai_icon_dark.svg')
                    : getImageURL('images/common/ai_icon.svg')
            })
            const toggleAIChat = () => {
                const isEnabled = !store.state.isAiChatEnabled;
                store.dispatch("setIsAiChatEnabled", isEnabled);
                window.dispatchEvent(new Event("resize"));
            };

            const updatePatternInputs = debounce(() => {
                if (
                    regexPatternInputs.value.name === "" ||
                    regexPatternInputs.value.name === undefined ||
                    regexPatternInputs.value.pattern === "" ||
                    regexPatternInputs.value.pattern === undefined
                ) {
                    isFormEmpty.value = true;
                } else {
                    isFormEmpty.value = false;
                }

                isPatternValid.value = false;

                if (regexPatternInputs.value.pattern) {
                    try {
                    const regex = new RegExp(regexPatternInputs.value.pattern);
                    isPatternValid.value = regex.test(testString.value);
                    console.log(isPatternValid.value);
                    } catch (error) {
                    isPatternValid.value = false;
                    console.log(error);
                    }
                }
                }, 300);

            const saveRegexPattern = async () => {
                isSaving.value = true;
                const payload = {
                    name: regexPatternInputs.value.name,
                    pattern: regexPatternInputs.value.pattern,
                }

                try {
                    const response = props.isEdit ? await regexPatternService.update(store.state.selectedOrganization.identifier, props.data.id, payload) : await regexPatternService.create(store.state.selectedOrganization.identifier, payload);
                    if(response.status == 200){
                        q.notify({
                            color: "positive",
                            message: props.isEdit ? "Regex pattern updated successfully" : "Regex pattern created successfully",
                            timeout: 4000,
                        });
                        emit("close");
                        emit("update:list");
                    }
                } catch (error) {
                    if(error.response.status != 403){
                        q.notify({
                            color: "negative",
                            message: error.response?.data?.message || (props.isEdit ? "Failed to update regex pattern" : "Failed to create regex pattern"),
                            timeout: 4000,
                        });
                    }
                }
                finally{
                    isSaving.value = false;
                }
            }

            return {
                t,
                store,
                q,
                config,
                getBtnLogo,
                isHovered,
                toggleAIChat,
                isFullScreen,
                regexPatternInputs,
                expandState,
                testString,
                isFormEmpty,
                updatePatternInputs,
                saveRegexPattern,
                isSaving,
                isPatternValid
            }
    }
    });

  
  
</script>
  
  <style lang="scss">
  .add-regex-pattern-container {
    width: 600px !important;
  }
  .add-regex-pattern-o2ai-enabled {
    width: calc(100vw - 500px) !important;
  }
  .add-regex-pattern-title {
    font-weight: 400;
    font-size: 18px;
    text-align: left;
  }
  .add-regex-pattern-light {
    .add-regex-pattern-title {
        color: #000000;
    }
  }

  .add-regex-pattern-name-input .q-field__control {
    display: flex;
    align-items: center;
    height: 44px;
    }
    .add-regex-pattern-description-input .q-field__control {
    display: flex;
    align-items: center;
    height: 65px;
    }
    .regex-pattern-input-container {
        border: 0px 1px 1px 1px solid #E6E6E6  ;
    }
    .regex-pattern-test-string-container {
        border: 0px 1px 1px 1px solid #E6E6E6  ;
    }
    .add-regex-pattern-pattern-input .q-field__control {
    display: flex;
    align-items: center;
    height: 200px;
    }

    .dark-mode-regex-pattern-input .q-field__control  { 
        background-color:#181A1B !important;
        border-left: 1px solid #212121 !important;
        border-right: 1px solid #212121 !important;
        border-bottom: 1px solid #212121 !important;
        }
    .light-mode-regex-pattern-input .q-field__control  { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    }
.regex-pattern-input > div > div > div > textarea{
    height: 200px !important;
    resize: none !important;
    }

    .dark-mode-regex-test-string-input .q-field__control  { 
    background-color:#181A1B !important;
    border-left: 1px solid #212121 !important;
        border-right: 1px solid #212121 !important;
        border-bottom: 1px solid #212121 !important;
    }
    .light-mode-regex-test-string-input .q-field__control  { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    
    }
.regex-test-string-input > div > div > div > textarea{
    resize: none !important;
    }
    .is-pattern-valid > div > div  { 
        .q-field__native {
            color: green !important;
        }
    }


  </style>
  