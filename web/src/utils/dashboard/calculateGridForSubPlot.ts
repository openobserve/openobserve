// it is used to create grid array for gauge chart
export function calculateGridPositions(width: any, height: any, numGrids: any) {
  const gridArray: any = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }
  // Calculate the aspect ratio of the available space
  const aspectRatio = width / height;

  const { numRows, numCols } = calculateOptimalGrid(numGrids, aspectRatio);

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
  horizontal: 4, // Horizontal space between charts (px)
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
) {
  if (width <= 0 || height <= 0) {
    throw new Error("Width and height must be positive numbers");
  }

  if (leftMargin < 0) {
    throw new Error("Left margin must be non-negative");
  }

  const gridArray: Array<{
    left: string;
    top: string;
    width: string;
    height: string;
  }> = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }

  // Calculate the aspect ratio of the available space
  const aspectRatio = width / height;

  const { numRows, numCols } = calculateOptimalGrid(
    numGrids,
    aspectRatio,
    numOfColumns,
  );

  // Validate total horizontal spacing doesn't exceed width
  const totalHorizontalSpacing =
    SPACING_CONFIG.horizontal * (numCols - 1) + leftMargin + 32;
  if (totalHorizontalSpacing >= width) {
    throw new Error("Total horizontal spacing exceeds available width");
  }

  // Validate total vertical spacing doesn't exceed height
  const totalVerticalSpacing = SPACING_CONFIG.vertical * (numRows - 1) + 72;
  if (totalVerticalSpacing >= height) {
    throw new Error("Total vertical spacing exceeds available height");
  }

  // How many cols
  const xSpacingBetween =
    ((SPACING_CONFIG.horizontal * (numCols - 1)) / width) * 100;
  const ySpacingBetween =
    ((SPACING_CONFIG.vertical * (numRows - 1)) / height) * 100;
  const topPadding = (SPACING_CONFIG.padding.top / height) * 100;
  const bottomPadding = (SPACING_CONFIG.padding.bottom / height) * 100;

  const leftPadding =
    ((leftMargin + SPACING_CONFIG.padding.extraLeft) / width) * 100;
  const rightPadding = (SPACING_CONFIG.padding.right / width) * 100;

  // width and height for single gauge
  const cellWidth =
    (100 - (xSpacingBetween + rightPadding + leftPadding)) / numCols;
  const cellHeight =
    (100 - (ySpacingBetween + topPadding + bottomPadding)) / numRows;

  // will create 2D grid array
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (gridArray.length >= numGrids) {
        break;
      }
      const grid = {
        left: `${col * cellWidth + col * ((SPACING_CONFIG.horizontal / width) * 100) + leftPadding}%`,
        top: `${row * cellHeight + row * ((SPACING_CONFIG.vertical / height) * 100) + topPadding}%`,
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

function calculateOptimalGrid(
  numGrids: number,
  aspectRatio: number,
  forcedColumns?: number,
): { numRows: number; numCols: number } {
  if (forcedColumns && forcedColumns > 0) {
    return {
      numCols: forcedColumns,
      numRows: Math.ceil(numGrids / forcedColumns),
    };
  }

  let numRows = Math.ceil(Math.sqrt(numGrids / aspectRatio));

  // Binary search for optimal row count
  let low = 1,
    high = numRows;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const cols = Math.ceil(numGrids / mid);
    if (mid * cols >= numGrids) {
      numRows = mid;
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return { numRows, numCols: Math.ceil(numGrids / numRows) };
}
