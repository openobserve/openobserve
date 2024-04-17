import { ref, watch, type Ref } from "vue";

export const useAutoCompleteForPromql = (
  options: Ref<any>,
  searchKey: string
) => {
  const filteredOptions = ref(options.value);
  console.log(
    "[useAutoCompleteForPromql] Initial filteredOptions:",
    filteredOptions.value
  );

  watch(options, (newValue, oldValue) => {
    console.log("[useAutoCompleteForPromql] options.value changed:", newValue);
    filteredOptions.value = newValue;
    console.log(
      "[useAutoCompleteForPromql] Updated filteredOptions:",
      filteredOptions.value
    );
  });

  const filterFn = (val: any) => {
    if (val === "") {
      console.log("[useAutoCompleteForPromql] Empty value:", val);
      filteredOptions.value = options.value;
      return;
    }

    const regex = /{([^{}]*)$/;
    console.log("[useAutoCompleteForPromql] Regex:", regex);

    const dollarRegex = /\$([^{}]*)$/;
    console.log("[useAutoCompleteForPromql] Dollar Regex:", dollarRegex);

    const match = regex.exec(val);
    console.log("[useAutoCompleteForPromql] Match:", match);

    const dollarMatch = dollarRegex.exec(val);
    console.log("[useAutoCompleteForPromql] Dollar Match:", dollarMatch);

    if (match) {
      console.log("[useAutoCompleteForPromql] Match found:", match);

      const needle = match[1].toLowerCase();
      console.log("[useAutoCompleteForPromql] Extracted needle:", needle);

      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        console.log(
          "[useAutoCompleteForPromql] Condition:",
          lowerCaseValue.includes(needle)
        );
        return lowerCaseValue.includes(needle);
      });
    } else if (dollarMatch) {
      console.log(
        "[useAutoCompleteForPromql] Dollar match found:",
        dollarMatch
      );
      const needle = dollarMatch[1].toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        console.log(
          "[useAutoCompleteForPromql] Condition:",
          lowerCaseValue.includes(needle)
        );
        return lowerCaseValue.includes(needle);
      });
    } else {
      console.log("[useAutoCompleteForPromql] No match found:", val);

      const needle = val.toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        console.log("[useAutoCompleteForPromql] Check value:", lowerCaseValue);
        console.log("[useAutoCompleteForPromql] Check needle:", needle);
        return lowerCaseValue.includes(needle);
      });
    }
  };

  return { filteredOptions, filterFn };
};
