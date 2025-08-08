import { ref, watch, type Ref } from "vue";

export const useSearchInputUsingRegex = (
  options: Ref<any>,
  searchKey: string,
  searchRegex: string
) => {
  const filteredOptions = ref([...options.value]);

  watch(options, (newValue) => {
    if (!filteredOptions.value.length) {
      filteredOptions.value = [...newValue];
    }
  });

  console.log("useSearchInputUsingRegex", filteredOptions.value);
  const filterFn = (val: any) => {
    console.log("filterFn", val);
    if (val === "") {
      filteredOptions.value = [...options.value];
      return;
    }

    const regex = new RegExp(searchRegex, "gi");
    let match = regex.exec(val)
    
    if(!match) {
      filteredOptions.value = [];
      return;
    }

    let needle: any = null;
    for (let i = 1; i < match.length; i++) {
      console.log("match", match[i]);
      
      if (match[i] !== undefined) {
        console.log("match found", match[i]);
        
        needle = match[i];
        break;
      }
    }
    console.log("match and needle", match, needle);

    filteredOptions.value = options.value?.filter((option: any) => {
      const value =
      typeof option === "object" ? option[searchKey] : option.toString();

      const lowerCaseValue = value?.toLowerCase();

      console.log("lowerCaseValue", lowerCaseValue);

      if (!lowerCaseValue || typeof lowerCaseValue !== "string") return false;

      console.log(lowerCaseValue.includes(needle), "lowercase include value needle");
      return lowerCaseValue.includes(needle);
    });
    console.log("filteredOptions", filteredOptions.value);
  };

  return { filteredOptions, filterFn };
};
