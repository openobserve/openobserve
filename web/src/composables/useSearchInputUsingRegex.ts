import { ref, watch, type Ref } from "vue";

export const useSearchInputUsingRegex = (
  options: Ref<any>,
  searchKey: string,
  searchRegex: string
) => {
  const filteredOptions = ref(options.value);

  watch(options, (newValue) => {
    filteredOptions.value = newValue;
  });

  const filterFn = (val: any) => {
    if (val === "") {
      filteredOptions.value = options.value;
      return;
    }

    const regex = new RegExp(searchRegex, "g");
    console.log("regex", regex);
    

    const match = regex.exec(val);
    if (!match) {
      filteredOptions.value = [];
    }
    console.log("match", match);
    
    const needle = match?.[1]?.toLowerCase();
    console.log("needle", needle);
    

    filteredOptions.value = options.value?.filter((option: any) => {
      const value =
        typeof option === "object" ? option[searchKey] : option.toString();
      const lowerCaseValue = value.toLowerCase();
      return lowerCaseValue.includes(needle);
    });
  };

  return { filteredOptions, filterFn };
};
