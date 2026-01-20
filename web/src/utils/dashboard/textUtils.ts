/**
 * Checks if a string is in a valid format or not
 * @param name
 * @returns
 */
export const generateLabelFromName = (name: string) => {
    return name
        .replace(/[\_\-\s\.]/g, " ")
        .split(" ")
        .map((string) => string.charAt(0).toUpperCase() + string.slice(1))
        .filter((it) => it)
        .join(" ");
};

/**
 * Calculates the width of a given text.
 * Useful to calculate nameGap for the left axis
 *
 * @param {string} text - The text to calculate the width of.
 * @param {string} fontSize - The font size of the text.
 * @return {number} The width of the text in pixels.
 */
export const calculateWidthText = (
    text: string,
    fontSize: string = "12px",
): number => {
    if (!text) return 0;

    const span = document.createElement("span");
    document.body.appendChild(span);

    span.style.font = "sans-serif";
    span.style.fontSize = fontSize || "12px";
    span.style.height = "auto";
    span.style.width = "auto";
    span.style.top = "0px";
    span.style.position = "absolute";
    span.style.whiteSpace = "no-wrap";
    span.innerHTML = text;

    const width = Math.ceil(span.clientWidth);
    span.remove();
    return width;
};

/**
 * Calculates the optimal font size for a given text that fits the canvas width.
 * @param text - The text to calculate the font size for.
 * @param canvasWidth - canvas width in pixels
 * @returns {number} - The optimal font size in pixels.
 */
export const calculateOptimalFontSize = (text: string, canvasWidth: number) => {
    let minFontSize = 1; // Start with the smallest font size
    let maxFontSize = 90; // Set a maximum possible font size
    let optimalFontSize = minFontSize;

    while (minFontSize <= maxFontSize) {
        const midFontSize = Math.floor((minFontSize + maxFontSize) / 2);
        const textWidth = calculateWidthText(text, `${midFontSize}px`);

        if (textWidth > canvasWidth) {
            maxFontSize = midFontSize - 1; // Text is too wide, reduce font size
        } else {
            optimalFontSize = midFontSize; // Text fits, but we try larger
            minFontSize = midFontSize + 1;
        }
    }

    return optimalFontSize; // Return the largest font size that fits
};
