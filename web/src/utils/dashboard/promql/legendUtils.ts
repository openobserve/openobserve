/**
 * Retrieves the legend name for a given metric and label.
 *
 * @param {any} metric - The metric object containing the values for the legend name placeholders.
 * @param {string} label - The label template for the legend name. If null or empty, the metric object will be converted to a JSON string and returned.
 * @return {string} The legend name with the placeholders replaced by the corresponding values from the metric object.
 */
export const getPromqlLegendName = (metric: any, label: string) => {
    if (label) {
        let template = label || "";
        const placeholders = template.match(/\{([^}]+)\}/g);

        // Step 2: Iterate through each placeholder
        placeholders?.forEach(function (placeholder: any) {
            // Step 3: Extract the key from the placeholder
            const key = placeholder.replace("{", "").replace("}", "");

            // Step 4: Retrieve the corresponding value from the JSON object
            const value = metric[key];

            // Step 5: Replace the placeholder with the value in the template
            if (value) {
                template = template.replace(placeholder, value);
            }
        });
        return template;
    } else {
        return JSON.stringify(metric);
    }
};

/**
 * Determines the position of the legend based on the provided legendPosition.
 *
 * @param {string} legendPosition - The desired position of the legend. Possible values are "bottom" or "right".
 * @return {string} The position of the legend. Possible values are "horizontal" or "vertical".
 */
export const getLegendPosition = (legendPosition: string) => {
    switch (legendPosition) {
        case "bottom":
            return "horizontal";
        case "right":
            return "vertical";
        default:
            return "horizontal";
    }
};
