<template>
    <div
      :class="store.state.theme === 'dark' ? 'dark-theme-history-page' : 'light-theme-history-page'"
      >
  
      <div class="flex tw-justify-between tw-items-center" >
        <div class="flex items-center q-py-sm q-pl-md">
          <div
          data-test="add-alert-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px;"
          title="Go Back"
          @click="closeSearchHistory">
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div class="text-h6" data-test="add-alert-title">
         Search History
        </div>
        </div>
        <div class="flex items-center q-py-sm q-pr-md">
          <date-time
              ref="dateTimeRef"
              auto-apply
              :default-type="searchObj.data.datetime.type"

              data-test="alerts-history-date-time-dropdown"
              @on:date-change="updateDateTime"
            />
            <div>
              <q-btn
                color="secondary"
                label="Get History"
                @click="fetchSearchHistory"
                class="q-ml-md"
              />
            </div>
  
        </div>
      </div>
  
      <div class="full-width">
    <q-page>
      <q-table
        ref="qTable"
        :rows="dataToBeLoaded"
        :columns="columnsToBeRendered"
        :pagination="pagination"
        @row-click="onRowClick"
        hide-bottom
        row-key="trace_id"

        :rows-per-page-options="[]"
        class="custom-table"
        style="width: 100%;"
      >


      <template v-slot:body="props">
  <q-tr :props="props" @click="triggerExpand(props)">
    <q-td 
      :class="`column-${col.name}`"
      v-for="col in props.cols"
      :key="col.name"
      :props="props"
    >
      {{ col.value }}
    </q-td>
    
  </q-tr>
  <q-tr v-show="expandedRow === props.row.trace_id" :props="props" >

    <q-td colspan="100%">

      <div class="text-left tw-px-2 expanded-content">
        <strong >SQL Query:</strong>

        <div class="tw-flex tw-items-start tw-justify-center" >
       
         <div class="scrollable-content  ">
          <pre style="text-wrap: wrap;">{{ props.row?.sql }}</pre>

         </div>
         <div class="tw-pl-2">
          <q-btn
            @click.stop="copyToClipboard(props.row.sql)"
            size="xs"
            icon="content_copy"
            class="copy-btn tw-py-3"
          />
         </div>
        
         
        </div>
      </div>
    </q-td>
  </q-tr>
</template>


      </q-table>
      <div v-if="!isLoading && dataToBeLoaded.length === 0">
        <NoData />
      </div>
      <div
            v-if="isLoading"
            class="text-center full-width full-height q-mt-lg tw-flex tw-justify-center"
          >
            <q-spinner-hourglass color="primary" size="lg" />
          </div>
    </q-page>
    
    </div>
  </div>
 

      <!-- Show NoData component if there's no data to display -->

  </template>
  <script lang="ts">
  //@ts-nocheck
  import { ref, watch, onMounted  , nextTick} from 'vue';
  import {
    timestampToTimezoneDate} from "@/utils/zincutils";
  import { useRouter, useRoute } from 'vue-router';
  import { useStore } from 'vuex';
  import { defineAsyncComponent ,defineComponent} from 'vue';
  import useLogs from '../../composables/useLogs'
  import TenstackTable from '../../plugins/logs/TenstackTable.vue';
  import searchService from "@/services/search";
  import NoData from "@/components/shared/grid/NoData.vue";
  import DateTime from "@/components/DateTime.vue";
  import { useI18n } from 'vue-i18n';
  import { date , QTable , useQuasar } from 'quasar';
  import type { Ref } from "vue";
  export default defineComponent({
    name: "SearchHistoryComponent",
    components: {
      DateTime,
      NoData,
    },
    props: {
    },
    emits: ['closeSearchHistory'],
    methods: {
        closeSearchHistory() {
        this.$emit('closeSearchHistory');
      },
    },
    setup(props, { emit }) {
      const router = useRouter();
      const $q = useQuasar();
      const route = useRoute();
      const store = useStore();
      const {t} = useI18n();
      const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
      const dateTimeRef = ref(null)
      const { searchObj } = useLogs();
      const dataToBeLoaded :any = ref([]);
      const dateTimeToBeSent : any = ref({});
      const columnsToBeRendered = ref([]);
      const  expandedRow = ref( []); // Array to track expanded rows
      const isLoading = ref(false);

      const pagination = {
            page: 1,
              rowsPerPage: 50 
      }
      const generateColumns = (data: any) => {
     if (data.length === 0) return [];

  // Define the desired column order and names
  const desiredColumns = [
    { key: 'trace_id', label: 'Trace ID' },
    { key: 'start_time', label: 'Start Time' },
    { key: 'end_time', label: 'End Time' },
    { key: 'took', label: 'Took' },
    { key: 'cached_ratio', label: 'Cached Ratio' },
    { key: 'scan_size', label: 'Scan Size' },
    { key: 'scan_records', label: 'Scan Records' },
    { key: 'sql', label: 'SQL Query' },
    // { key: 'duration', label: 'Duration' },
  ];

  return desiredColumns.map(({ key, label }) => {
    let columnWidth = 200;
    let align = "center";
    if(key == "scan_records" || key == "cached_ratio" || key == "took"){
      columnWidth = 80
    }
    if(key == "scan_size"){
      columnWidth = 80
    }
    if( key == 'start_time' || key == 'end_time'){
      columnWidth = 250
    }
    if(key == 'sql'){
      columnWidth = 350
    }
    if(key == "trace_id"){
      columnWidth = 250
      align = "left"
    }
   // Custom width for each column
    return {
      name: key,        // Field name
      label: label,     // Column label
      field: key,       // Field accessor
      align: 'center',
      sortable: true,
      style: `max-width: ${columnWidth}px; width: ${columnWidth}px;`,
    };
  });
};
    

      const fetchSearchHistory = async ( ) => {
        columnsToBeRendered.value = [];
        dataToBeLoaded.value = [];
        expandedRow.value = [];
     try {
      const {org_identifier} = router.currentRoute.value.query;
        isLoading.value = true;
        const {startTime, endTime} = dateTimeToBeSent.value;
 
        const response = await searchService.get_history( org_identifier,startTime,endTime,
           );
           columnsToBeRendered.value = generateColumns(response.data.hits);
           response.data.hits.forEach((hit:any)=>{
            hit.start_time = timestampToTimezoneDate(hit.start_time / 1000, store.state.timezone, "yyyy-MM-dd HH:mm:ss.SSS");
            console.log(hit.start_time,"start")
            hit.end_time = timestampToTimezoneDate(hit.end_time / 1000, store.state.timezone, "yyyy-MM-dd HH:mm:ss.SSS");
            hit.took  = formatTime(hit.took);
            hit.duration = calculateDuration(hit.start_time, hit.end_time);
            })
           dataToBeLoaded.value = response.data.hits;
           dataToBeLoaded.value[0].sql = `SELECT 
    e.employee_id,
    e.first_name,
    e.last_name,
    e.email,
    d.department_name,
    m.manager_name,
    j.job_title,
    l.location_name,
    c.country_name,
    r.region_name,
    (
        SELECT AVG(salary)
        FROM employees
        WHERE department_id = e.department_id
    ) AS avg_department_salary,
    (
        SELECT COUNT(*)
        FROM projects p
        WHERE p.employee_id = e.employee_id
    ) AS project_count
FROM 
    employees e
JOIN 
    departments d ON e.department_id = d.department_id
LEFT JOIN 
    managers m ON e.manager_id = m.manager_id
JOIN 
    jobs j ON e.job_id = j.job_id
JOIN 
    locations l ON d.location_id = l.location_id
JOIN 
    countries c ON l.country_id = c.country_id
JOIN 
    regions r ON c.region_id = r.region_id
WHERE 
    e.hire_date > '2020-01-01'
    AND e.salary > (
        SELECT AVG(salary) 
        FROM employees
    )
    AND e.employee_id IN (
        SELECT employee_id
        FROM project_assignments
        WHERE project_id IN (
            SELECT project_id
            FROM projects
            WHERE project_status = 'Active'
        )
    )
ORDER BY 
    e.last_name, e.first_name
LIMIT 100;`;
           
          // dataToBeLoaded.value = response.data;
          isLoading.value = false;
     } catch (error) {
      console.log(error, "error")
      isLoading.value = false;
     } finally {
      isLoading.value = false;
     }
        

      };
      const  copyToClipboard = (text) => {
      navigator.clipboard.writeText(text).then(() => {
        $q.notify({
            type: "positive",
            message: "Content Copied Successfully!",
            timeout: 5000,
          });
      }).catch(() => {
          $q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
      });
    }
      
      const updateDateTime = async (value: any) => {
        if (
          value.valueType == "absolute" &&
          searchObj.data.stream.selectedStream.length > 0 &&
          searchObj.data.datetime.queryRangeRestrictionInHour > 0 &&
          value.hasOwnProperty("selectedDate") &&
          value.hasOwnProperty("selectedTime") &&
          value.selectedDate.hasOwnProperty("from") &&
          value.selectedTime.hasOwnProperty("startTime")
        ) {
          // Convert hours to microseconds
          let newStartTime: any =
            parseInt(value.endTime) -
            searchObj.data.datetime.queryRangeRestrictionInHour *
              60 *
              60 *
              1000000;
          if (parseInt(newStartTime) > parseInt(value.startTime)) {
            value.startTime = newStartTime;
            value.selectedDate.from = timestampToTimezoneDate(
              value.startTime / 1000,
              store.state.timezone,
              "yyyy/MM/DD",
            );
            value.selectedTime.startTime = timestampToTimezoneDate(
              value.startTime / 1000,
              store.state.timezone,
              "HH:mm",
            );
              dateTimeRef.value?.setAbsoluteTime(value.startTime, value.endTime);
              dateTimeRef.value?.setDateType("absolute");
            
          }
        }
        const {startTime, endTime} = value;
        dateTimeToBeSent.value = {
          startTime,
          endTime,
        };
        await nextTick ();
        await nextTick();
        await nextTick();
        await nextTick();
      };
      const  formatTime = (took)  => {
      return `${took.toFixed(2)} sec`;
    }
    const calculateDuration = (startTime, endTime) => {
      // Calculate the duration in microseconds
      const durationMicroseconds = endTime - startTime;
      
      // Convert microseconds to seconds
      const durationSeconds = durationMicroseconds / 1e6;

      // Convert to minutes and hours if needed
      if (durationSeconds < 60) {
        return `${durationSeconds.toFixed(2)} seconds`;
      } else if (durationSeconds < 3600) {
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        return `${minutes} minutes and ${seconds.toFixed(2)} seconds`;
      } else {
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        return `${hours} hours and ${minutes} minutes`;
      }
    }

      const triggerExpand = (props) =>{
        if (expandedRow.value === props.row.trace_id) {
            expandedRow.value = null;
          } else {
            // Otherwise, expand the clicked row and collapse any other row
            expandedRow.value = props.row.trace_id;
  }
      }
      const   onRowClick = (evt, row) => {
      console.log("Row clicked:", row);
      // row.expand = !row.expand; // Log the row data
      // const index = expandedRows.value.indexOf(row.trace_id);
      // console.log(index, "index")
      // if (index === -1) {
      //   expandedRows.value.push(row.trace_id);
      //   console.log(expandedRows.value, "expandedRows")
      // } else {
      //   expandedRows.value.splice(index, 1); // Optional: toggle functionality
      // }
    };
      onMounted(() => {
        fetchSearchHistory(); 
      })
      return {
        searchObj,
        store,
        generateColumns,
        fetchSearchHistory,
        dataToBeLoaded,
        columnsToBeRendered,
        t,
        route,
        isLoading,
        qTable,
        updateDateTime,
        pagination,  
        dateTimeRef,
        expandedRow,
        onRowClick,
        triggerExpand,
        copyToClipboard,
        formatTime,
      };
      // Watch the searchObj for changes
      
    },
  });
  </script>
 <style lang="scss" scoped >
.expanded-content {
  min-width: 100vh;
  max-height: 100vh; /* Set a fixed height for the container */
  overflow: hidden; /* Hide overflow by default */
}

.scrollable-content {
  width: 100%; /* Use the full width of the parent */
  overflow-y: auto; /* Enable vertical scrolling for long content */
  padding: 10px; /* Optional: padding for aesthetics */
  border: 1px solid #ddd; /* Optional: border for visibility */
  height: 100%;
  max-height: 200px;
   /* Use the full height of the parent */
  text-wrap: normal;
}
.q-td {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.custom-table .q-tr > .q-td:first-child {
  text-align: left;
}



 </style>