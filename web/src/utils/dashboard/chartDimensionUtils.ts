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

/**
 * Calculates a dynamic nameGap for the x-axis based on label rotation.
 * When labels are rotated, we need more space between the labels and the axis name.
 *
 * @param {number} rotate - The rotation angle of the labels in degrees (0-90).
 * @param {number} labelWidth - The maximum width of truncated labels in pixels (default: 120).
 * @param {number} fontSize - The font size of the labels in pixels (default: 12).
 * @param {number} defaultNameGap - The default nameGap to use when rotation is 0 (default: 25).
 * @param {number} axisLabelMargin - The margin between axis and labels (default: 10).
 * @return {number} The calculated nameGap value.
 */
export const calculateDynamicNameGap = (
  rotate: number = 0,
  labelWidth: number = 120,
  fontSize: number = 12,
  defaultNameGap: number = 25,
  axisLabelMargin: number = 10,
): number => {
  // If no rotation, return the default nameGap
  if (rotate === 0) {
    return defaultNameGap;
  }

  // Convert rotation to radians
  const rotationInRadians = (Math.abs(rotate) * Math.PI) / 180;

  // Calculate the vertical height occupied by rotated label (Section Height)
  // When a label of width W is rotated by angle ╬╕:
  // - The vertical height = W * sin(╬╕) + fontSize * cos(╬╕)
  const verticalHeight =
    labelWidth * Math.sin(rotationInRadians) +
    fontSize * Math.cos(rotationInRadians);

  // Calculate nameGap: vertical height + axis label margin + small buffer (8px)
  // The buffer ensures there's slight spacing between longest label tip and axis name
  const calculatedNameGap = Math.ceil(verticalHeight + axisLabelMargin + 8);

  // Return the maximum of calculated and default to ensure minimum spacing
  return Math.max(calculatedNameGap, defaultNameGap);
};

/**
 * Calculates the additional bottom spacing needed for rotated x-axis labels.
 * This ensures rotated labels don't overlap with legends or get cut off.
 *
 * @param {number} rotate - The rotation angle of the labels in degrees (0-90).
 * @param {number} labelWidth - The maximum width of truncated labels in pixels (default: 120).
 * @param {number} fontSize - The font size of the labels in pixels (default: 12).
 * @param {boolean} hasAxisName - Whether the axis has a name/title (default: false).
 * @param {number} nameGap - The gap between axis and its name (optional).
 * @return {number} The additional spacing needed in pixels.
 */
export const calculateRotatedLabelBottomSpace = (
  rotate: number = 0,
  labelWidth: number = 120,
  fontSize: number = 12,
  hasAxisName: boolean = false,
  nameGap: number = 0,
): number => {
  // If no rotation, no additional space needed
  if (rotate === 0) {
    return 0;
  }

  // Convert rotation to radians
  const rotationInRadians = (Math.abs(rotate) * Math.PI) / 180;

  // Calculate the vertical height occupied by rotated label
  const verticalHeight =
    labelWidth * Math.sin(rotationInRadians) +
    fontSize * Math.cos(rotationInRadians);

  if (hasAxisName) {
    // If there's an axis name, nameGap already covers the label height.
    // We just need to add enough space for the axis name itself (~20px)
    // and some buffer.
    const axisNameEstimatedHeight = 20;
    const totalNeededSpace = (nameGap || verticalHeight + 10) + axisNameEstimatedHeight;

    // Default bottom spacing in charts is typically ~35-50px.
    // Only add if totalNeeded exceeds a reasonable base (e.g., 40px)
    return Math.max(0, Math.ceil(totalNeededSpace - 40));
  } else {
    // Without axis name, containLabel: true in grid config handles the space automatically
    // for rotated labels. No additional bottom spacing is needed because:
    // 1. containLabel: true makes ECharts automatically expand grid to fit labels
    // 2. The grid.bottom value already provides base spacing
    // 3. Adding extra space here causes unnecessary whitespace
    return 10; // Let ECharts handle it with containLabel
  }
};
