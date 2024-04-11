import { ref, watch, type Ref } from "vue";

export const useSelectAutoComplete2 = (
  options: Ref<any>,
  searchKey: string
) => {
  const filteredOptions = ref(options.value);
  console.log(
    "[useSelectAutoComplete2] Initial filteredOptions:",
    filteredOptions.value
  );

  watch(options, (newValue, oldValue) => {
    console.log("[useSelectAutoComplete2] options.value changed:", newValue);
    filteredOptions.value = newValue;
    console.log(
      "[useSelectAutoComplete2] Updated filteredOptions:",
      filteredOptions.value
    );
  });

  const filterFn = (val: any, update: any) => {
    if (val === "") {
      update(() => {
        console.log("[useSelectAutoComplete2] Empty value:", val);
        filteredOptions.value = options.value;
      });
      return;
    }

    const regex = /\$\{(\w+)/g;
    console.log("[useSelectAutoComplete2] Regex:", regex);

    const match = regex.exec(val);
    console.log("[useSelectAutoComplete2] Match:", match);

    if (match) {
      console.log("[useSelectAutoComplete2] Match found:", match);

      const placeholder = match[1];
      const needle = val.replace(regex, "").toLowerCase();
      console.log("[useSelectAutoComplete2] Extracted needle:", needle);

      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        const lowerCaseNeedle = needle.toLowerCase();
        console.log("[useSelectAutoComplete2] Check value:", lowerCaseValue);
        console.log("[useSelectAutoComplete2] Check needle:", lowerCaseNeedle);
        console.log(
          "[useSelectAutoComplete2] Condition:",
          lowerCaseValue.indexOf(lowerCaseNeedle) > -1 &&
            (lowerCaseValue.startsWith(placeholder) || !placeholder)
        );
        return (
          lowerCaseValue.indexOf(lowerCaseNeedle) > -1 &&
          (lowerCaseValue.startsWith(placeholder) || !placeholder)
        );
      });
    } else {
      console.log("[useSelectAutoComplete2] No match found:", val);

      const needle = val.toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        console.log("[useSelectAutoComplete2] Check value:", lowerCaseValue);
        console.log("[useSelectAutoComplete2] Check needle:", needle);
        return lowerCaseValue.indexOf(needle) > -1;
      });
    }
  };

  return { filteredOptions, filterFn };
};
