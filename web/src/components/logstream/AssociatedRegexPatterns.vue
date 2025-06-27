<template>
    <div style="width: 60vw; height: calc(100vh - 59px);" :class="store.state.theme === 'dark' ? 'tw-bg-[#1F1F1F] dark-regex-patterns' : 'tw-bg-white light-regex-patterns'">
        <div class="tw-flex tw-items-center no-wrap tw-justify-between tw-px-4 tw-py-2">
        <div class="tw-flex tw-items-center">
            <div class="col-auto">
            <q-btn v-close-popup="true" round flat icon="arrow_back" />
        </div>
          <div
            class="tw-flex tw-items-center"
            data-test="associated-regex-patterns-title-text"
          >
            <span class="breadcrumb-text tw-cursor-pointer " @click="closeDialog"   >Stream Details &gt; &nbsp;
            </span>
        <span class="associated-field-name">
                 {{ fieldName }}
                </span>
          </div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup="true" round flat icon="close" />
        </div>
      </div>
      <q-separator />
      
      <!-- here we will have the main section -->
      <div class="tw-flex tw-w-full tw-h-[calc(100vh-59px)]">
        <!-- here we will have the left side section -->
        <div class="tw-w-[25%]">
            <div class="tw-flex tw-flex-col tw-px-2 tw-py-2">

                <div>
                    <q-input
                    data-test="schema-field-search-input"
                    v-model="filterPattern"
                    data-cy="schema-index-field-search-input"
                    filled
                    borderless
                    dense
                    debounce="1"
                    placeholder="Search"
                >
                  <template #prepend>
                    <q-icon name="search" />
                  </template>
                </q-input>
                </div>
                <div style="height: calc(100vh - 130px); overflow-y: auto;">
                  <div
                    class="pattern-list-wrapper "
                  >
                    <q-expansion-item
                      expand-separator
                      ref="appliedPatternsExpandedRef"
                      :label="`Applied Patterns (${appliedPatterns.length})`"
                      class="q-mt-sm tw-text-[14px] tw-font-[600] associated-regex-patterns-table "
                    >
                      <q-card class="q-pa-none q-ma-none" style="height: 100%;">
                        <q-card-section class="q-pa-none q-ma-none" style="height: 100%;">
                          <q-table
                            style="height: 100%; overflow-y: auto;"
                            :rows="appliedPatterns"
                            :columns="appliedFilterColumns"
                            :visible-columns="['pattern_name']"
                            :class="store.state.theme === 'dark' ? 'dark-associated-regex-patterns-table' : 'light-associated-regex-patterns-table'"
                            :rows-per-page-options="[0]"
                            hide-header
                            hide-bottom
                            dense
                            :filter="filterPattern"
                            @:ilter-method="handleFilterMethod"
                          >
                            <template v-slot:body="props">
                              <q-tr class="tw-cursor-pointer " :class="[checkCurrentUserClickedPattern(props.row.pattern_name) && store.state.theme === 'dark' ? 'dark-selected-pattern-row' : checkCurrentUserClickedPattern(props.row.pattern_name) ? 'light-selected-pattern-row' : '']" :props="props" @click="handlePatternClick(props.row)">
                                <q-td class="tw-flex tw-justify-between tw-items-center" style="border-bottom: 0px; font-size: 14px; font-weight: 600; padding-top: 20px; padding-bottom: 20px;" :props="props" key="pattern_name">
                                  <span class="regex-pattern-name">
                                    {{ props.row.pattern_name }}
                                  </span>
                                  <span><q-icon name="check" size="xs" color="primary" /></span>
                                </q-td>
                              </q-tr>
                            </template>
                          </q-table>

                        </q-card-section>
                      </q-card>
                    </q-expansion-item>
                  </div>
                  <q-separator class="tw-mt-2" />
                  <div
                    class="pattern-list-wrapper"
                  >
                    <q-expansion-item
                      expand-separator
                      ref="allPatternsExpandedRef"
                      :label="`All Patterns (${resultTotal})`"
                      class="q-mt-sm tw-text-[14px] tw-font-[600] associated-regex-patterns-table "

                    >
                      <q-card class="q-pa-none q-ma-none" style="height: 100%;">
                        <q-card-section class="q-pa-none q-ma-none" style="height: 100%;">
                          <q-table
                            style="height: 100%; overflow-y: auto;"
                            :class="store.state.theme === 'dark' ? 'dark-associated-regex-patterns-table' : 'light-associated-regex-patterns-table'"
                            :rows="allPatterns"
                            :columns="filterColumns"
                            :visible-columns="['pattern_name']"
                            :rows-per-page-options="[0]"
                            hide-header
                            hide-bottom
                            dense
                            :filter="filterPattern"
                            @:filter-method="handleFilterMethod"
                          >
                          <template v-slot:body="props">
                              <q-tr style="padding: 8px 0px !important;"  class="tw-cursor-pointer" :class="[checkCurrentUserClickedPattern(props.row.pattern_name) && store.state.theme === 'dark' ? 'dark-selected-pattern-row' : checkCurrentUserClickedPattern(props.row.pattern_name) ? 'light-selected-pattern-row' : '']" :props="props" @click="handlePatternClick(props.row)">
                                <q-td  class="tw-flex tw-justify-between tw-items-center " style="border-bottom: 0px;  font-size: 14px; font-weight: 600; padding-top: 20px; padding-bottom: 20px; " :props="props" key="pattern_name">
                                 <span class="regex-pattern-name">{{ props.row.pattern_name }}</span> 
                                  <span v-if="checkIfPatternIsApplied(props.row.pattern_id)">
                                    <q-icon name="check" size="xs" color="primary" />
                                  </span>
                                </q-td>
                              </q-tr>
                            
                            </template>   
                          </q-table>
                        </q-card-section>
                      </q-card>
                    </q-expansion-item>
                  </div>
                </div>

            </div>
        </div>
        <q-separator vertical />
        <!-- here we will have the right side section -->
        <div class="tw-w-[75%] tw-h-full tw-flex tw-flex-col tw-justify-between">
          <div v-if="userClickedPattern" class="tw-flex tw-flex-col tw-gap-3 tw-px-4 tw-h-full">
            <!-- pattern name section -->
            <div class="tw-flex tw-flex-col tw-gap-1">
              <span class="individual-section-title">
                Pattern name
              </span>
              <span class="individual-section-sub-information">
                {{ userClickedPattern.pattern_name }}
              </span>
            </div>
            <!-- pattern description section -->
            <div class="tw-flex tw-flex-col tw-gap-1">
              <span class="individual-section-title">
              Pattern Description
              </span>
              <span class="individual-section-sub-information">
                {{ userClickedPattern.description ? userClickedPattern.description : 'No description available' }}
              </span>
            </div>
            <!-- when value matches -->
            <div class="tw-flex tw-flex-col">
              <span class="individual-section-title">When value matches:
              </span>
              <div class="tw-flex tw-gap-8">
                <div class="tw-flex tw-items-start">
                <q-radio v-model="policy" val="Redact">

                </q-radio>
                <div class="tw-flex tw-flex-col tw-items-start tw-mt-[6px] individual-section-sub-title">
                    Redact
                    <span class="tw-font-[400] individual-section-sub-information">
                      This will obscure the email field 
                    </span>
                  </div>

              </div>
              <div class="tw-flex tw-items-start">
                <q-radio v-model="policy" val="DropField">

                </q-radio>
                <div class="tw-flex tw-flex-col tw-items-start tw-mt-[6px] individual-section-sub-title">
                    Drop
                    <span class="tw-font-[400] individual-section-sub-information">
                      This will remove the email field completely
                    </span>
                  </div>
                  
              </div>
              </div>
            </div>
            <!-- detach at section -->
            <div class="tw-flex tw-flex-col">
              <span class="individual-section-title">
                Detect at:
              </span>
              <div class="tw-flex tw-gap-8 tw-ml-2">
                <q-checkbox size="sm" v-model="apply_at" val="AtIngestion" >
                  <span class="individual-section-sub-title">Ingestion Stage</span>
                </q-checkbox>
                <q-checkbox size="sm" v-model="apply_at" val="AtSearch">
                  <span class="individual-section-sub-title">During Logs Search</span>
                </q-checkbox>

              </div>
            </div>

            <q-separator />

            <!-- test pattern section -->

            <div class="tw-flex tw-flex-col tw-gap-2">
              <span class="individual-section-title">
                Test Pattern
              </span>
              <div class="tw-flex tw-flex-col">
                <span class="individual-section-sub-title2">
                  Regex Pattern
                </span>
                <span class="regex-pattern-text">
                  {{ userClickedPattern.pattern }}
                </span>
              </div>
              <div>
                <span class="individual-section-sub-title2">
                  Add Test
                </span>
                <div 
                    ref="editableDiv"
                    contenteditable="true"
                    class="editable-div"
                    :class="[
                        store.state.theme === 'dark' ? 'dark-mode' : 'light-mode',
                    ]"
                    @input="handleTestStringInput"
                    @paste="handlePaste"
                    :placeholder="'Eg: sybihsfv@gmailcom'"
                    v-html="highlightedText"
                ></div>
              </div>
              <q-separator />
            </div>

            <!-- remove or add pattern button  -->
             <div class="add-remove-pattern-button">
              <q-btn @click="handleAddOrRemovePattern" no-caps class="no-border">
                <span>
                  {{ checkIfPatternIsApplied(userClickedPattern.pattern_id) ? 'Remove Pattern' : 'Add Pattern' }}
                </span> 
              </q-btn>
             </div>

             <!-- cancel and update settings button -->
 
          </div>
          <q-separator />
          <div v-if="userClickedPattern" :class="store.state.theme === 'dark' ? 'dark-regex-patterns-footer' : 'light-regex-patterns-footer'" class="flex justify-end tw-px-4 tw-py-2" style="position: sticky; bottom: 0; right: 0;">
                <q-btn
                    v-close-popup="true"
                    data-test="add-stream-cancel-btn"
                    label="Cancel"
                    class="q-my-sm text-bold q-mr-md"
                    padding="sm md"
                    no-caps
                    style="border: 1px solid #E6E6E6;"

                />
                <q-btn
                    data-test="save-stream-btn"
                    label="Update Changes"
                    class="q-my-sm text-bold no-border"
                    padding="sm xl"
                    type="submit"
                    no-caps
                    @click="updateRegexPattern"
                    :style="{
                      'background-color': isFormDirty ? '#5ca380' : '#aeaeae',
                      'color': isFormDirty ? '#ffffff' : '#000000'
                      }"
                    :disabled="!isFormDirty"
                />
          </div>
          <div class="tw-h-full" v-if="!userClickedPattern">
            <div
              class="full-width column flex-center q-gutter-sm q-mt-xs"
              style="font-size: 1.5rem"
              :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
            >
              <q-img
                :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')"
                style="width: 125px; margin: 30vh auto 0rem"
              />
              <span class="no-pattern-applied-title">No Patterns Applied Yet</span>
                <span class="no-pattern-applied-subtitle">Browse the pattern library to begin </span> 
                <span class="no-pattern-applied-subtitle">
                  applying regular expressions to your fields.
                </span>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, onBeforeUnmount, PropType, ref, watch } from 'vue';
import { useStore } from 'vuex';
import  regexPatternsService  from '@/services/regex_pattern';
import { convertUnixToQuasarFormat, getImageURL } from '@/utils/zincutils';
import { debounce, useQuasar } from 'quasar';
import store from '@/test/unit/helpers/store';
import { useI18n } from 'vue-i18n';

export interface PatternAssociation {
    field: string;
    pattern_name: string;
    pattern_id: string;
    policy: string;
    apply_at: string;
}
export default defineComponent({
    name: "AssociatedRegexPatterns",
    props: {
        data: {
            type: Array as PropType<PatternAssociation[]>,
            required: true
        },
        fieldName: {
            type: String,
            required: true
        }
    },
    emits: ["closeDialog", "addPattern", "removePattern", "updateSettings"],
    setup(props, { emit }){
        const store = useStore();
        const filterPattern = ref("");
        const { t } = useI18n();
          const appliedFilterColumns = ref<any[]>([
            { name: "pattern_name", label: "Name", field: "pattern_name", align: "left" }
          ]);
          const filterColumns = ref<any[]>([
            { name: "pattern_name", label: "Name", field: "pattern_name", align: "left" }
          ]);
        const allPatterns = ref([]);
        const selectedPatterns = ref<any[]>([]);
        const listLoading = ref(false);
        const resultTotal = ref(0);
        const appliedPatterns = ref(props.data ? props.data : []);
        const allPatternsExpanded = ref(true);
        const appliedPatternsExpanded = ref(true);
        const $q = useQuasar();
        const userClickedPattern = ref<any>(null);
        const isPatternValid = ref(false);
        const testString = ref("");
        const policy = ref("Redact");
        const apply_at = ref<any>([]);
        const appliedPatternsExpandedRef = ref<any>(null);
        const allPatternsExpandedRef = ref<any>(null);
        const isFormDirty = ref(false);
        const highlightedText = ref("");
        const editableDiv = ref<HTMLElement | null>(null);
        const debouncedUpdateHighlighting = ref(debounce((text: string) => {
            if (userClickedPattern.value?.pattern && text) {
                try {
                    const regex = new RegExp(userClickedPattern.value.pattern, 'g');
                    let html = text;
                    
                    // Save current cursor position relative to text content
                    const selection = window.getSelection();
                    let cursorOffset = 0;
                    if (selection && selection.rangeCount > 0 && editableDiv.value) {
                        const range = selection.getRangeAt(0);
                        const preCaretRange = range.cloneRange();
                        preCaretRange.selectNodeContents(editableDiv.value);
                        preCaretRange.setEnd(range.endContainer, range.endOffset);
                        cursorOffset = preCaretRange.toString().length;
                    }

                    const matches = Array.from(text.matchAll(regex));
                    
                    // Replace matches from end to start to avoid position issues
                    for (let i = matches.length - 1; i >= 0; i--) {
                        const match = matches[i];
                        if (match.index !== undefined) {
                            const start = match.index;
                            const end = start + match[0].length;
                            const before = html.substring(0, start);
                            const matched = html.substring(start, end);
                            const after = html.substring(end);
                            html = before + `<span class="match">${matched}</span>` + after;
                        }
                    }
                    
                    highlightedText.value = html;
                    isPatternValid.value = matches.length > 0;

                    // Restore cursor position after Vue updates the DOM
                    nextTick(() => {
                        if (editableDiv.value) {
                            // Create a temporary div to count positions including newlines
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = html;
                            
                            const textNodes = [];
                            const offsets = [];
                            let totalOffset = 0;
                            
                            // Walk through all nodes and calculate their positions
                            const walk = document.createTreeWalker(
                                editableDiv.value,
                                NodeFilter.SHOW_TEXT,
                                null
                            );
                            
                            let node;
                            while (node = walk.nextNode()) {
                                textNodes.push(node);
                                offsets.push(totalOffset);
                                totalOffset += node.textContent?.length || 0;
                            }

                            // Find the right node and offset
                            let targetNode = textNodes[0];
                            let targetOffset = 0;

                            for (let i = 0; i < textNodes.length; i++) {
                                const nextOffset = i + 1 < offsets.length ? offsets[i + 1] : totalOffset;
                                if (offsets[i] <= cursorOffset && cursorOffset <= nextOffset) {
                                    targetNode = textNodes[i];
                                    targetOffset = cursorOffset - offsets[i];
                                    break;
                                }
                            }

                            if (targetNode && selection) {
                                const range = document.createRange();
                                range.setStart(targetNode, targetOffset);
                                range.setEnd(targetNode, targetOffset);
                                selection.removeAllRanges();
                                selection.addRange(range);
                                
                                // Ensure the cursor is visible
                                const rect = range.getBoundingClientRect();
                                if (rect) {
                                    editableDiv.value.scrollTop = rect.top - editableDiv.value.offsetHeight / 2;
                                }
                            }
                        }
                    });
                } catch (error) {
                    isPatternValid.value = false;
                    console.log(error);
                }
            } else {
                highlightedText.value = text;
                isPatternValid.value = false;
            }
        }, 300));
        const closeDialog = () => {
            emit("closeDialog");
        }
        onMounted( async () => {
          if(store.state.organizationData.regexPatterns.length == 0){
            await getRegexPatterns();
          }
          else{
            allPatterns.value = store.state.organizationData.regexPatterns.map((pattern: any) => ({
              ...pattern,
              pattern_name: pattern.name,
              pattern_id: pattern.id,
              apply_at: "",
              policy: ""
            }));
            resultTotal.value = store.state.organizationData.regexPatterns.length;
          }
          makeSyncWithAppliedPatterns();
          await nextTick();
          appliedPatternsExpandedRef.value.toggle();
          allPatternsExpandedRef.value.toggle();
          //this is done because we dont want to show the empty page at first when user lands at this page
          if(props.data.length > 0){
            userClickedPattern.value = props.data[0];
          }
        })
        //reset the values when user clicks on a pattern from the list
        //because we need to reset the values when user clicks on a pattern from the list
        watch(()=> userClickedPattern.value, (newVal) => {
          console.log(newVal,'newVal');
          let applied_at_value = newVal.apply_at;
          if(applied_at_value == 'Both'){
            apply_at.value = ['AtIngestion', 'AtSearch'];
          }
          else{
            apply_at.value = applied_at_value ? [applied_at_value] : [];
          }
          policy.value = newVal.policy || "Redact";
          testString.value = "";
          isPatternValid.value = false;
        })
        //this runs when users clicks on add / remove pattern button 
        //to update the applied patterns list
        watch(()=> props.data.length, (newVal) => {
          isFormDirty.value = true;
          appliedPatterns.value = [...props.data];
          makeSyncWithAppliedPatterns();
        })
        watch(()=> policy.value, (newVal) => {
          console.log(newVal,'newVal');
          checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)
        })
        watch(()=> apply_at.value, (newVal) => {
          console.log(newVal,'newVal');
          checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)
        })


        const getRegexPatterns = async () => {
            listLoading.value = true;
            try{
              const response = await regexPatternsService.list(store.state.selectedOrganization.identifier);
              let counter = 1;
              allPatterns.value = response.data.patterns.map((pattern: any) => ({
                ...pattern,
                "#": counter <= 9 ? `0${counter++}` : counter++,
                created_at: convertUnixToQuasarFormat(pattern.created_at),
                updated_at: convertUnixToQuasarFormat(pattern.updated_at),
                pattern_name: pattern.name,
                pattern_id: pattern.id
              }));
              store.dispatch("setRegexPatterns", allPatterns.value);
              resultTotal.value = allPatterns.value.length;
            } catch (error) {
              $q.notify({
                message: error.data.message || "Error fetching regex patterns",
                color: "negative",
                icon: "error",
              });
            }
            finally{
              listLoading.value = false;
            }
          }
        const checkIfPatternIsApplied = (patternId: string) => {
          return appliedPatterns.value.some((pattern: any) => pattern.pattern_id === patternId);
        }
        const handlePatternClick = (pattern: any) => {
          userClickedPattern.value = pattern;
        }
        const checkCurrentUserClickedPattern = (patternName: string) => {
          return userClickedPattern.value?.pattern_name === patternName;
        }

        const handleTestStringInput = (event: InputEvent) => {
            const target = event.target as HTMLElement;
            testString.value = target.innerText;
            debouncedUpdateHighlighting.value(target.innerText);
        };

        const handlePaste = (event: ClipboardEvent) => {
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') || '';
            document.execCommand('insertText', false, text);
        };

        const handleFilterMethod = (rows: any, terms: any) => {
          var filtered = [];
            terms = terms.toLowerCase();
            for (var i = 0; i < rows.length; i++) { 
              if (rows[i]["name"].toLowerCase().includes(terms)) {
                filtered.push(rows[i]);
              }
            }
            resultTotal.value = filtered.length;
            return filtered;
        }

        const updateRegexPattern = () => {
          emit("updateSettings");
          isFormDirty.value = false;
        }

        const handleAddOrRemovePattern = () => {
          if(checkIfPatternIsApplied(userClickedPattern.value.pattern_id)){
            //remove pattern
            emit("removePattern", userClickedPattern.value.pattern_id, props.fieldName);
            appliedPatterns.value = appliedPatterns.value.filter((pattern: any) => pattern.pattern_id !== userClickedPattern.value.pattern_id);
          }
          else{
            if(apply_at.value.length == 0){
              $q.notify({
                message: "Please select detect at option",
                color: "negative",
                icon: "error",
              });
              return;
            }
            let apply_at_value = "";
            //add pattern
            if(apply_at.value.length == 2){
              apply_at_value = 'Both';
            }
            else{
              apply_at_value = apply_at.value[0];
            }
            const pattern = {
              field: props.fieldName,
              pattern_name: userClickedPattern.value.pattern_name,
              pattern_id: userClickedPattern.value.pattern_id,
              policy: policy.value,
              apply_at: apply_at_value,
              pattern: userClickedPattern.value.pattern,
              description: userClickedPattern.value.description
            }
            emit("addPattern", pattern);
          }
        }

        const makeSyncWithAppliedPatterns = () => {
          const appliedMap = new Map(
            props.data.map((p: any) => [p.pattern_id, p])
          );

          allPatterns.value.forEach((pattern: any) => {
            const applied = appliedMap.get(pattern.id);
            if (applied) {
              pattern.policy = applied.policy;
              pattern.apply_at = applied.apply_at;
            }
          });
        };

        const checkIfPatternIsAppliedAndUpdate = (patternId: string) => {
          let applied_pattern = appliedPatterns.value.find((pattern: any) => pattern.pattern_id === patternId);
          let apply_at_value = "";
          if(apply_at.value.length == 2){
            apply_at_value = 'Both';
          }
          else{
            apply_at_value = apply_at.value[0] || "";
          }
          if(applied_pattern){
            applied_pattern.policy !== policy.value || applied_pattern.apply_at !== apply_at_value ? isFormDirty.value = true : isFormDirty.value = false;
          }
        }

        // Add cleanup
        onBeforeUnmount(() => {
            // Cancel any pending debounced calls
            if (debouncedUpdateHighlighting.value?.cancel) {
                debouncedUpdateHighlighting.value.cancel();
            }
            
            // Clear references
            editableDiv.value = null;
            userClickedPattern.value = null;
            appliedPatternsExpandedRef.value = null;
            allPatternsExpandedRef.value = null;
        });

        return {
            store,
            closeDialog,
            filterPattern,
            filterColumns,
            selectedPatterns,
            allPatterns,
            allPatternsExpanded,
            listLoading,
            resultTotal,
            getRegexPatterns,
            appliedPatterns,
            appliedPatternsExpanded,
            appliedFilterColumns,
            checkIfPatternIsApplied,
            handlePatternClick,
            userClickedPattern,
            checkCurrentUserClickedPattern,
            testString,
            policy,
            apply_at,
            isPatternValid,
            handleTestStringInput,
            handlePaste,
            appliedPatternsExpandedRef,
            allPatternsExpandedRef,
            handleFilterMethod,
            updateRegexPattern,
            handleAddOrRemovePattern,
            isFormDirty,
            getImageURL,
            t,
            highlightedText,
            editableDiv
        }
    }
})

</script>

<style lang="scss">
.breadcrumb-text{
    font-size: 18px;
    font-weight: 400;
    line-height: 24px;
}
.associated-field-name{
    font-size: 18px;
    font-weight: 400;
    line-height: 24px;
}
.light-regex-patterns{
    .breadcrumb-text{
        color: #5960b2;        
    }
    .associated-field-name{
        color: #000;
    }
}
.dark-regex-patterns{
  .breadcrumb-text{
    color: #5960b2;
  }
  .associated-field-name{
    color: #fff;
  }
}

    .individual-section-title{
      font-size: 16px;
      font-weight: 600;
      line-height: 24px;
    }
    .individual-section-sub-title{
      font-size: 14px;
      font-weight: 600;
      line-height: 24px;
    }
    .individual-section-sub-title2{
      font-size: 14px;
      font-weight: 500;
      line-height: 24px;
    }
    .individual-section-sub-information{
      font-size: 14px;
      font-weight: 400;
      line-height: 24px;
    }
    .regex-pattern-text{
      font-size: 12px;
      font-weight: 400;
      line-height: 24px;
    }


    .light-regex-patterns{
      .individual-section-title{
        color: #000000;
      }
      .individual-section-sub-title{
        color: #000000;
      }
      .individual-section-sub-information{
        color: #000000;
      }
      .regex-pattern-text{
        color: #5A5A5A;
      }
    }
    .add-remove-pattern-button{
      color:#5960B2;
      border: 1px solid #5960B2 ;
      width: fit-content;
    }

    .dark-mode-regex-test-string-input .q-field__control  { 
        background-color:transparent !important;
        border-left: 1px solid #666666 !important;
        border-top: 1px solid #666666 !important;
        border-right: 1px solid #666666 !important;
        border-bottom: 1px solid #666666 !important;
    }
  .light-mode-regex-test-string-input .q-field__control  { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-top: 1px solid #E6E6E6 !important;
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

    .light-selected-pattern-row {
    background-color: #E1E3F6;
  }
  .dark-selected-pattern-row {
    background-color: #7C87EF38 !important;
  }
.dark-associated-regex-patterns-table{
  background-color: #1F1F1F !important;
}
.associated-regex-patterns-table{
  .q-table__card{
    border-radius: 0px !important;
  }
}
.dark-regex-patterns-footer{
  background-color: #1F1F1F !important;
}
.light-regex-patterns-footer{
  background-color: #ffffff !important;
}
.regex-pattern-name {
  white-space: nowrap;
  overflow: hidden;
  max-width: 10vw;
  text-overflow: ellipsis;
  text-transform: none !important;
  }
  .no-pattern-applied-title{
    font-size: 16px;
    font-weight: 600;
    line-height: 32px;
  }
  .no-pattern-applied-subtitle{
    font-size: 14px;
    font-weight: 400;
    line-height: 12px;
  }
    .editable-div {
        height: 100px;
        max-height: 100px;
        padding: 12px;
        border: 1px solid #E6E6E6;
        border-radius: 4px;
        outline: none;
        font-family: monospace;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        overflow-y: auto;
        
        &.dark-mode {
            background-color: #181A1B;
            border-color: #212121;
            color: #ffffff;
        }
        
        &.light-mode {
            background-color: #ffffff;
            border-color: #E6E6E6;
            color: #000000;
        }

        &:empty:before {
            content: attr(placeholder);
            color: #999;
        }

        .match {
            background-color: rgba(92, 163, 128, 0.3);
            border-radius: 2px;
        }
    }
</style>