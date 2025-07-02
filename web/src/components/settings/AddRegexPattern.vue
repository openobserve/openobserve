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
                    data-test="add-regex-pattern-back-btn"
                    v-close-popup="true"
                    round
                    flat
                    icon="arrow_back"
                />
          <div class="add-regex-pattern-title" data-test="add-regex-pattern-title">
            {{ isEdit ? t("regex_patterns.edit_regex_pattern") : t("regex_patterns.create_regex_pattern") }}
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
            data-test="add-regex-pattern-fullscreen-btn"
            icon="fullscreen" 
            size="14px" 
            dense 
            class="tw-cursor-pointer" 
            :class="store.state.theme === 'dark' ? 'tw-text-white' : ''"
            :color="isFullScreen ? 'primary' : undefined"
            @click="toggleFullScreen"
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
            :class="store.state.isAiChatEnabled ? isFullScreen ? 'tw-w-[75%] q-pl-sm' : 'tw-w-[65%] q-pl-sm' : 'tw-w-[100%] q-px-md'"
            >
            <q-form @submit="saveRegexPattern" class="tw-flex tw-flex-col tw-gap-4" style="overflow: auto; height: calc(100vh - 150px);">
                <div class="tw-flex tw-flex-col">
                    <q-input
                        v-bind:readonly="isEdit"
                        v-bind:disable="isEdit"
                        v-model="regexPatternInputs.name"
                        :label="t('regex_patterns.name') + ' *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        data-test="add-regex-pattern-name-input"
                        stack-label
                        outlined
                        filled
                        dense
                        :lazy-rules="true"
                        :rules="[val => val !== '' || '* Name is required']"
                        />
                    <q-input
                        v-model="regexPatternInputs.description"
                        :label="t('regex_patterns.description')"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-pb-md showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        data-test="add-regex-pattern-description-input"
                        />
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
                        data-test="add-regex-pattern-input"
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
                    <div v-if="expandState.regexTestString" class="regex-pattern-input" >
                        <query-editor
                        data-test="add-regex-pattern-test-string-editor"
                        ref="queryEditorRef"
                        editor-id="regex-pattern-test-string-editor"
                        class="tw-w-full regex-pattern-test-string-editor"
                        :debounceTime="300"
                        v-model:query="testString"
                        @update:query="updateTestString"
                        style="height: 100px !important;"
                        language="markdown"
                        :showLineNumbers="false"
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input'"
                         />
                    </div>
                </div>
                </div>

            </q-form>
            <div class="flex justify-end q-mt-sm" style="position: sticky; bottom: 0; right: 0;">
                <q-btn
                    v-close-popup="true"
                    data-test="add-regex-pattern-cancel-btn"
                    :label="t('regex_patterns.cancel')"
                    class="q-my-sm text-bold q-mr-md"
                    padding="sm md"
                    no-caps
                    style="border: 1px solid #E6E6E6;"
                />
                <q-btn
                    data-test="add-regex-pattern-save-btn"
                    :label="isSaving ? 'Saving...' : isEdit ? t('regex_patterns.update_close') : t('regex_patterns.create_close')"
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
import { defineComponent, onMounted, ref, watch, nextTick, onBeforeUnmount } from "vue";
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
import { useRouter } from "vue-router";
import QueryEditor from "../QueryEditor.vue";
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
        O2AIChat,
        QueryEditor
    },
setup(props, {emit}) {
    const { t } = useI18n();

    const store = useStore();

    const q = useQuasar();

    const isHovered = ref(false);

    const isFullScreen = ref(false);

    const router = useRouter();


    const testString = ref("");
    const highlightedText = ref("");
    const editableDiv = ref<HTMLElement | null>(null);
    let savedSelection: { start: number; end: number } | null = null;

    const isFormEmpty = ref(props.isEdit ? false : true);

    const isPatternValid = ref(false);

    const queryEditorRef = ref<any>(null);

    const isSaving = ref(false);


    onMounted(()=>{
        if(props.isEdit){
            regexPatternInputs.value.name = props.data.name;
            regexPatternInputs.value.pattern = props.data.pattern;
        }
        else{
            regexPatternInputs.value = {
                name: "",
                pattern: "",
                description: ""
            }
        }
        if(router.currentRoute.value.query.from == 'logs'){
            let value = store.state.organizationData.customRegexPatternFromLogs.value ? store.state.organizationData.customRegexPatternFromLogs.value : store.state.organizationData.regexPatternFromLogs.value;
            if(value){
                testString.value = value;
            }
            store.dispatch('setIsAiChatEnabled',true);
        }
    })


    onBeforeUnmount(() => {
        // Cancel any pending debounced calls
        updateTestString.cancel();
    });

    // Form validation watcher
    watch([() => regexPatternInputs.value.name, () => regexPatternInputs.value.pattern], () => {
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
    });

    // Watch for pattern changes to update highlighting
    watch(() => regexPatternInputs.value.pattern, (newPattern) => {
        if (testString.value && queryEditorRef.value) {
            queryEditorRef.value.highlightRegexMatches(newPattern?.trim());
        }
    });

    const regexPatternInputs: any = ref({
        name: "",
        pattern: "",
        description: "",//this is optional we dont consider it anyway but it is should go in the payload with atleast empty string if user doesnot provide it
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


    const saveRegexPattern = async () => {
        isSaving.value = true;
        //payload for create and update regex pattern
        // we need to send the name , pattern , description
        const payload = {
            name: regexPatternInputs.value.name,
            pattern: regexPatternInputs.value.pattern,
            description: regexPatternInputs.value.description,
        }
        //here we are emitting close and update:list to the parent component
        //this is used to close the dialog and update the regex pattern list
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

    const updateTestString = debounce((value: string) => {
        testString.value = value;

        if (queryEditorRef.value) {
            queryEditorRef.value.highlightRegexMatches(regexPatternInputs.value.pattern?.trim());
        }
    }, 300);


    const toggleFullScreen = () => {
        isFullScreen.value = !isFullScreen.value;
        window.dispatchEvent(new Event("resize"));
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
        saveRegexPattern,
        isSaving,
        isPatternValid,
        queryEditorRef,
        updateTestString,
        toggleFullScreen
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

    .dark-mode-regex-test-string-input  { 
        background-color:#181A1B !important;
        border-left: 2px solid #212121 !important;
        border-right: 2px solid #212121 !important;
        border-bottom: 2px solid #212121 !important;
    }
    .light-mode-regex-test-string-input { 
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

  <style lang="scss">
      .regex-pattern-test-string-editor{
        .lines-content{
            padding-left: 12px !important;
        }

    }
    .light-mode-regex-test-string-input{
        .monaco-editor-background{
            background-color: #ffffff !important;
        }
    }
    .dark-mode-regex-test-string-input{
        .monaco-editor-background{
            background-color: #181a1b !important;
        }
    }
</style>

  