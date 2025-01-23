// it is used to create grid array for gauge chart
export function calculateGridPositions(width: any, height: any, numGrids: any) {
  const gridArray: any = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }
  // Calculate the aspect ratio of the available space
  const aspectRatio = width / height;

  let numRows = 1;
  let numCols = 1;

  try {
    const optionalGrid = calculateOptimalGrid(numGrids, aspectRatio);
    numRows = optionalGrid.numRows;
    numCols = optionalGrid.numCols;
  } catch (err: any) {
    console.error("Error in calculateGridPositions:", err?.message);
  }

  // width and height for single gauge
  const cellWidth = 100 / numCols;
  const cellHeight = 100 / numRows;

  // will create 2D grid array
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const grid = {
        left: `${col * cellWidth}%`,
        top: `${row * cellHeight}%`,
        width: `${cellWidth}%`,
        height: `${cellHeight}%`,
      };
      gridArray.push(grid);
    }
  }

  // return grid array, width, height, gridNoOfRow, gridNoOfCol
  return {
    gridArray: gridArray,
    gridWidth: (cellWidth * width) / 100,
    gridHeight: (cellHeight * height) / 100,
    gridNoOfRow: numRows,
    gridNoOfCol: numCols,
  };
}

// Configuration object for chart spacing and padding
const SPACING_CONFIG = {
  horizontal: 15, // Horizontal space between charts (px)
  vertical: 30, // Vertical space between charts (px)
  padding: {
    top: 20, // Top padding for title (px)
    bottom: 52, // Bottom padding for legend/controls (px)
    right: 16, // Right padding (px)
    extraLeft: 16, // Additional left padding beyond margin (px)
  },
};

// it is used to create grid array for trellis chart
export function getTrellisGrid(
  width: number,
  height: number,
  numGrids: number,
  leftMargin: number,
  numOfColumns: number = -1,
  axisWidth: number | null = 10,
) {
  if (width <= 0) {
    throw new Error("Width and height must be positive numbers");
  }

  if (leftMargin < 0) {
    throw new Error("Left margin must be non-negative");
  }

  if (typeof numGrids !== "number" || numGrids < 0) {
    throw new Error("Number of grids must be a non-negative number");
  }

  const gridArray: Array<{
    left: string;
    top: string;
    width: string;
    height: string;
  }> = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return { gridArray: gridArray };
  }

  // Calculate the aspect ratio of the available space
  const aspectRatio = 16 / 9;

  let numRows = 1;
  let numCols = 1;

  try {
    const optionalGrid = calculateOptimalGrid(
      numGrids,
      aspectRatio,
      numOfColumns,
    );
    numRows = optionalGrid.numRows;
    numCols = optionalGrid.numCols;
  } catch (err: any) {
    console.error("Error in calculateGridPositions:", err?.message);
  }

  const xSpacingBetweenInPx = SPACING_CONFIG.horizontal * (numCols - 1);
  const leftPaddingInPx =
    Math.max(leftMargin, axisWidth || 0) + SPACING_CONFIG.padding.extraLeft;
  const rightPaddingInPx = SPACING_CONFIG.padding.right;

  // width and height for single gauge
  let cellWidthInPx =
    (width - rightPaddingInPx - leftPaddingInPx - xSpacingBetweenInPx) /
    numCols;

  // Calculate cell height based on cell width
  const cellHeightInPx = cellWidthInPx * 0.4;

  let totalChartHeight =
    cellHeightInPx * numRows +
    SPACING_CONFIG.vertical * (numRows - 1) +
    SPACING_CONFIG.padding.top +
    SPACING_CONFIG.padding.bottom;

  totalChartHeight = Math.max(totalChartHeight, height);

  if (totalChartHeight > height) {
    // as scroll bar will be added, so increse the right padding
    const widthToReduce = 16 / numCols;
    cellWidthInPx = cellWidthInPx - widthToReduce;
  }

  // will create 2D grid array
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (gridArray.length >= numGrids) {
        break;
      }
      const grid = {
        left: `${col * cellWidthInPx + col * SPACING_CONFIG.horizontal + leftPaddingInPx}`,
        top: `${row * cellHeightInPx + row * SPACING_CONFIG.vertical + SPACING_CONFIG.padding.top}`,
        width: `${cellWidthInPx}`,
        height: `${cellHeightInPx}`,
      };
      gridArray.push(grid);
    }
  }

  // return grid array, width, height, gridNoOfRow, gridNoOfCol
  return {
    gridArray: gridArray,
    gridNoOfRow: numRows,
    gridNoOfCol: numCols,
    panelHeight: totalChartHeight,
  };
}

function calculateOptimalGrid(
  numGrids: number,
  aspectRatio: number,
  forcedColumns?: number,
): { numRows: number; numCols: number } {
  if (numGrids <= 0) {
    throw new Error("Number of grids must be positive");
  }

  if (aspectRatio <= 0) {
    throw new Error("Aspect ratio must be positive");
  }

  if (forcedColumns && forcedColumns > 0) {
    return {
      numCols: forcedColumns,
      numRows: Math.ceil(numGrids / forcedColumns),
    };
  }

  let numRows = Math.ceil(Math.sqrt(numGrids / aspectRatio));
  let numCols = Math.ceil(numGrids / numRows);

  // Binary search for optimal row count
  while ((numRows - 1) * numCols >= numGrids) {
    numRows--;
    numCols = Math.ceil(numGrids / numRows);
  }

  return { numRows, numCols };
}
