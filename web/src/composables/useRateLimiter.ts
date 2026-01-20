// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { useStore } from "vuex";
import { reactive } from "vue";
import { ref } from "vue";
import { useQuasar } from "quasar";
import rateLimiterService from "@/services/rate_limit";
 const  useRateLimiter = () => {
    const store = useStore();
    const q = useQuasar();
    let isApiLimitsLoading = ref<boolean>(false);
    let isRoleLimitsLoading = ref<boolean>(false);

    const getApiLimitsByOrganization = async ( orgId: string, interval: string = 'second') => {
      try {
        isApiLimitsLoading.value = true;
          const response = await rateLimiterService.getApiLimits(orgId, interval);
          let transformedData: any = [];

          //predefined operation that we get from the api
          const operations = ['list', 'get', 'create', 'update', 'delete'];
          // Iterate over each module in api_group_info
          Object.keys(response.data).forEach((moduleName) => {
              const module = response.data[moduleName];

              // Create an object to store the threshold values for each operation
              let moduleThresholds: any = {
                  module_name: moduleName,
              };

              operations.forEach((operation) => {
                  // Check if the operation exists for the current module
                  if (module[operation.toLowerCase()] !== undefined) {
                      // If the operation exists, get the threshold value
                      moduleThresholds[operation.toLowerCase()] =  module[operation.toLowerCase()];
                  } else {
                      // If the operation doesn't exist, set it as '--'
                      moduleThresholds[operation.toLowerCase()] = '-';
                  }
              });
              // Add the transformed data to the array
              transformedData.push(moduleThresholds);
          });
          transformedData.sort((a: any, b: any) => a.module_name.localeCompare(b.module_name));
          // Store with interval-specific key
          store.dispatch("setApiLimitsByOrgId", {
            ...store.state.allApiLimitsByOrgId,
            [`${orgId}_${interval}`]: transformedData,
          });
          //this is done because once we update the api limits , we need to reset the role limits so that when we can fetch the latest roles limits from the api (updated one)
          store.dispatch("setRoleLimitsByOrgIdByRole", {
            ...store.state.allRoleLimitsByOrgIdByRole,
            [orgId]: [],
          });
          isApiLimitsLoading.value = false;
      return transformedData;
  } catch (error) {
    isApiLimitsLoading.value = false;
      console.log(error);
  }
    };
    const getRoleLimitsByOrganization = async (orgId: string, rolename: string, interval: string = 'second') => {
      try {
        isRoleLimitsLoading.value = true;
          const response = await rateLimiterService.getRoleLimits(orgId, rolename, interval);
          let transformedData: any = [];

      //predefined operation that we get from the api
      const operations = ['list', 'get', 'create', 'update', 'delete'];
      // Iterate over each module in api_group_info
      Object.keys(response.data).forEach((moduleName) => {
          const module = response.data[moduleName];

          // Create an object to store the threshold values for each operation
          let moduleThresholds: any = {
              module_name: moduleName,
          };

          operations.forEach((operation) => {
              // Check if the operation exists for the current module
              if (module[operation.toLowerCase()] !== undefined) {
                  // If the operation exists, get the threshold value
                  moduleThresholds[operation.toLowerCase()] =  module[operation.toLowerCase()];
              } else {
                  // If the operation doesn't exist, set it as '--'
                  moduleThresholds[operation.toLowerCase()] = '-';
              }
          });
          // Add the transformed data to the array
          transformedData.push(moduleThresholds);

      });
      transformedData.sort((a: any, b: any) => a.module_name.localeCompare(b.module_name));
      // Store with interval-specific key
      store.dispatch("setRoleLimitsByOrgIdByRole", {
        ...store.state.allRoleLimitsByOrgIdByRole,
        [orgId]: {
          ...store.state.allRoleLimitsByOrgIdByRole[orgId],
          [`${rolename}_${interval}`]: transformedData,
        },
      });
      isRoleLimitsLoading.value = false;
      return transformedData;
  } catch (error) {
      console.log(error);
      isRoleLimitsLoading.value = false;
  }
    };

    const getModulesToDisplay = async (orgId: string) => {
      try {
      const response = await rateLimiterService.getModules(orgId);
      const modulesToDisplay = response.data.map((role: any) => ({
        label: role,
        value: role
      })).sort((a: any, b: any) => a.label.localeCompare(b.label));
      //this is done to store the modules to display for the organization
      store.dispatch("setModulesToDisplay", {
        ...store.state.modulesToDisplay,
        [orgId]: modulesToDisplay,
      });
      return modulesToDisplay;
      } catch (error) {
      }


  }

    return {
        getApiLimitsByOrganization,
        getRoleLimitsByOrganization,
        getModulesToDisplay,
        isRoleLimitsLoading,
        isApiLimitsLoading,
    }
}
export default useRateLimiter;
