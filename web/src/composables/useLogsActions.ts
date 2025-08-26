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

import { computed } from "vue";
import { useStore } from "vuex";
import { useLogsState } from "@/composables/useLogsState";
import useFunctions from "@/composables/useFunctions";
import useActions from "@/composables/useActions";
import { useNotifications } from "@/composables/useNotifications";
import config from "@/aws-exports";

interface ActionItem {
  name: string;
  id: string;
}

interface FunctionItem {
  name: string;
  args: string;
}

interface TransformItem {
  name: string;
  function: string;
}

interface TransformConfig {
  type: "action" | "function";
  actionId?: string;
  functionContent?: string;
  selectedTransform?: any;
}

/**
 * Actions and functions management composable for logs functionality
 * Contains all action management, function management, and transformation operations
 */
export const useLogsActions = () => {
  const store = useStore();
  const { searchObj } = useLogsState();
  const { getAllFunctions } = useFunctions();
  const { getAllActions } = useActions();
  const { showErrorNotification } = useNotifications();

  // Computed properties
  const isActionsEnabled = computed(() => {
    return (config.isEnterprise == "true" || config.isCloud == "true") && store.state.zoConfig.actions_enabled;
  });

  const hasActiveTransform = computed(() => {
    return searchObj.data.tempFunctionContent.trim() !== "" || 
           (searchObj.data.transformType === "action" && searchObj.data.selectedTransform?.id);
  });

  const shouldAddFunctionToSearch = computed(() => {
    if (!isActionsEnabled.value) {
      return searchObj.data.tempFunctionContent !== "" && searchObj.meta.showTransformEditor;
    }
    return searchObj.data.transformType === "function" && searchObj.data.tempFunctionContent !== "";
  });

  const availableActions = computed(() => searchObj.data.actions || []);
  const availableFunctions = computed(() => searchObj.data.stream.functions || []);
  const availableTransforms = computed(() => searchObj.data.transforms || []);

  /**
   * Reset functions and transforms state
   */
  const resetFunctions = () => {
    try {
      store.dispatch("setFunctions", []);
      searchObj.data.transforms = [];
      searchObj.data.stream.functions = [];
    } catch (error: any) {
      console.error("Error resetting functions:", error);
    }
  };

  /**
   * Reset actions state
   */
  const resetActions = () => {
    try {
      searchObj.data.actions = [];
    } catch (error: any) {
      console.error("Error resetting actions:", error);
    }
  };

  /**
   * Reset all transform-related state
   */
  const resetTransforms = () => {
    try {
      resetFunctions();
      resetActions();
      searchObj.data.tempFunctionContent = "";
      searchObj.data.transformType = "";
      searchObj.data.selectedTransform = null;
      searchObj.data.actionId = "";
      searchObj.data.tempFunctionName = "";
      searchObj.data.tempFunctionLoading = false;
    } catch (error: any) {
      console.error("Error resetting transforms:", error);
    }
  };

  /**
   * Fetch and populate functions list
   */
  const getFunctions = async () => {
    try {
      if (store.state.organizationData.functions.length == 0) {
        await getAllFunctions();
      }

      store.state.organizationData.functions.map((data: any) => {
        const args: any = [];
        for (let i = 0; i < parseInt(data.num_args); i++) {
          args.push("'${1:value}'");
        }

        const itemObj: FunctionItem = {
          name: data.name,
          args: "(" + args.join(",") + ")",
        };

        searchObj.data.transforms.push({
          name: data.name,
          function: data.function,
        });

        if (!data.stream_name) {
          searchObj.data.stream.functions.push(itemObj);
        }
      });
      
      return searchObj.data.stream.functions;
    } catch (error: any) {
      console.error("Error while fetching functions:", error);
      showErrorNotification("Error while fetching functions");
      return [];
    }
  };

  /**
   * Fetch and populate actions list
   */
  const getActions = async () => {
    try {
      searchObj.data.actions = [];

      if (store.state.organizationData.actions.length == 0) {
        await getAllActions();
      }
      
      store.state.organizationData.actions.forEach((data: any) => {
        if (data.execution_details_type === "service") {
          searchObj.data.actions.push({
            name: data.name,
            id: data.id,
          });
        }
      });
      
      return searchObj.data.actions;
    } catch (error: any) {
      console.error("Error while fetching actions:", error);
      showErrorNotification("Error while fetching actions");
      return [];
    }
  };

  /**
   * Set function content for transformation
   */
  const setFunctionContent = (content: string) => {
    try {
      searchObj.data.tempFunctionContent = content;
      searchObj.data.transformType = "function";
    } catch (error: any) {
      console.error("Error setting function content:", error);
    }
  };

  /**
   * Set action for transformation
   */
  const setSelectedAction = (action: ActionItem) => {
    try {
      if (!action) {
        console.error("Error setting selected action: action is null or undefined");
        return;
      }
      searchObj.data.selectedTransform = action;
      searchObj.data.transformType = "action";
      searchObj.data.actionId = action.id;
    } catch (error: any) {
      console.error("Error setting selected action:", error);
    }
  };

  /**
   * Clear selected transformation
   */
  const clearSelectedTransform = () => {
    try {
      searchObj.data.tempFunctionContent = "";
      searchObj.data.selectedTransform = null;
      searchObj.data.transformType = "";
      searchObj.data.actionId = "";
    } catch (error: any) {
      console.error("Error clearing selected transform:", error);
    }
  };

  /**
   * Get function by name from transforms list
   */
  const getFunctionByName = (name: string) => {
    try {
      const result = searchObj.data.transforms.find((transform: TransformItem) => transform.name === name);
      return result || null;
    } catch (error: any) {
      console.error("Error getting function by name:", error);
      return null;
    }
  };

  /**
   * Get action by ID from actions list
   */
  const getActionById = (id: string) => {
    try {
      const result = searchObj.data.actions.find((action: ActionItem) => action.id === id);
      return result || null;
    } catch (error: any) {
      console.error("Error getting action by ID:", error);
      return null;
    }
  };

  /**
   * Validate function content
   */
  const validateFunctionContent = (content: string) => {
    const errors: string[] = [];
    
    try {
      if (!content.trim()) {
        errors.push("Function content cannot be empty");
        return { isValid: false, errors };
      }

      // Basic syntax validation
      if (!content.includes("return")) {
        errors.push("Function must contain a return statement");
      }

      // Check for potentially dangerous functions
      const dangerousPatterns = [
        /\beval\s*\(/,
        /\bexec\s*\(/,
        /\bsystem\s*\(/,
        /\bshell_exec\s*\(/
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
          errors.push("Function contains potentially dangerous operations");
          break;
        }
      }

      return { isValid: errors.length === 0, errors };
    } catch (error: any) {
      errors.push("Function validation failed: " + error.message);
      return { isValid: false, errors };
    }
  };

  /**
   * Apply function to search query
   */
  const applyFunctionToSearch = (functionContent: string) => {
    try {
      const validation = validateFunctionContent(functionContent);
      if (!validation.isValid) {
        showErrorNotification(`Function validation failed: ${validation.errors.join(", ")}`);
        return false;
      }

      setFunctionContent(functionContent);
      searchObj.meta.showTransformEditor = true;
      return true;
    } catch (error: any) {
      console.error("Error applying function to search:", error);
      showErrorNotification("Error applying function to search");
      return false;
    }
  };

  /**
   * Apply action to search query
   */
  const applyActionToSearch = (actionId: string) => {
    try {
      const action = getActionById(actionId);
      if (!action) {
        showErrorNotification("Selected action not found");
        return false;
      }

      setSelectedAction(action);
      return true;
    } catch (error: any) {
      console.error("Error applying action to search:", error);
      showErrorNotification("Error applying action to search");
      return false;
    }
  };

  /**
   * Get transform configuration for query building
   */
  const getTransformConfig = (): TransformConfig => {
    try {
      const config: TransformConfig = {
        type: searchObj.data.transformType as "action" | "function"
      };

      if (searchObj.data.transformType === "action" && searchObj.data.selectedTransform?.id) {
        config.actionId = searchObj.data.selectedTransform.id;
      }

      if (searchObj.data.transformType === "function" && searchObj.data.tempFunctionContent) {
        config.functionContent = searchObj.data.tempFunctionContent;
      }

      if (searchObj.data.selectedTransform) {
        config.selectedTransform = searchObj.data.selectedTransform;
      }

      return config;
    } catch (error: any) {
      console.error("Error getting transform config:", error);
      return { type: "function" };
    }
  };

  /**
   * Check if current transform is valid for execution
   */
  const isValidTransform = () => {
    try {
      if (searchObj.data.transformType === "function") {
        return searchObj.data.tempFunctionContent.trim() !== "";
      }

      if (searchObj.data.transformType === "action") {
        return searchObj.data.selectedTransform?.id != null;
      }

      return false;
    } catch (error: any) {
      console.error("Error validating transform:", error);
      return false;
    }
  };

  /**
   * Initialize actions and functions data
   */
  const initializeActionsData = async () => {
    try {
      resetFunctions();
      await getFunctions();
      
      if (isActionsEnabled.value) {
        await getActions();
      }
    } catch (error: any) {
      console.error("Error initializing actions data:", error);
    }
  };

  /**
   * Get summary of current transform state
   */
  const getTransformSummary = () => {
    try {
      return {
        hasActiveTransform: hasActiveTransform.value,
        transformType: searchObj.data.transformType,
        isValid: isValidTransform(),
        actionsEnabled: isActionsEnabled.value,
        functionsCount: searchObj.data.stream.functions.length,
        actionsCount: searchObj.data.actions.length,
        transformsCount: searchObj.data.transforms.length
      };
    } catch (error: any) {
      console.error("Error getting transform summary:", error);
      return null;
    }
  };

  return {
    // State
    availableActions,
    availableFunctions,
    availableTransforms,
    
    // Computed properties
    isActionsEnabled,
    hasActiveTransform,
    shouldAddFunctionToSearch,
    
    // Core operations
    getFunctions,
    getActions,
    initializeActionsData,
    
    // State management
    resetFunctions,
    resetActions,
    resetTransforms,
    
    // Transform operations
    setFunctionContent,
    setSelectedAction,
    clearSelectedTransform,
    applyFunctionToSearch,
    applyActionToSearch,
    
    // Utility functions
    getFunctionByName,
    getActionById,
    validateFunctionContent,
    getTransformConfig,
    isValidTransform,
    getTransformSummary,
  };
};

export default useLogsActions;