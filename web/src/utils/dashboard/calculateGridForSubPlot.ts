import { RFC_2822 } from "moment";

// it is used to create grid array for gauge chart
export function calculateGridPositions(width: any, height: any, numGrids: any) {
  const gridArray: any = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }
  // Calculate the aspect ratio of the available space
  const aspectRatio = width / height;

  // Calculate the number of rows and columns based on the aspect ratio
  let numRows = Math.ceil(Math.sqrt(numGrids / aspectRatio));
  let numCols = Math.ceil(numGrids / numRows);

  // Adjust the number of rows and columns if necessary to fit all grids
  while ((numRows - 1) * numCols >= numGrids) {
    numRows--;
    numCols = Math.ceil(numGrids / numRows);
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

// it is used to create grid array for trellis chart
export function getTrellisGrid(
  width: any,
  height: any,
  numGrids: any,
  leftMargin: number,
) {
  const gridArray: any = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }
  // Calculate the aspect ratio of the available space
  const aspectRatio = width / height;

  // Calculate the number of rows and columns based on the aspect ratio
  let numRows = Math.ceil(Math.sqrt(numGrids / aspectRatio));
  let numCols = Math.ceil(numGrids / numRows);

  // Adjust the number of rows and columns if necessary to fit all grids
  while ((numRows - 1) * numCols >= numGrids) {
    numRows--;
    numCols = Math.ceil(numGrids / numRows);
  }

  const spaceBetweenCharts = 4;

  // How many cols
  const xSpacingBetween = ((spaceBetweenCharts * (numCols - 1)) / width) * 100;
  const ySpacingBetween = ((30 * (numRows - 1)) / height) * 100;
  const topPadding = (20 / height) * 100;
  const bottomPadding = (52 / height) * 100;

  const leftPadding = ((leftMargin + 16) / width) * 100;
  const rightPadding = (16 / width) * 100;

  // width and height for single gauge
  const cellWidth =
    (100 - (xSpacingBetween + rightPadding + leftPadding)) / numCols;
  const cellHeight =
    (100 - (ySpacingBetween + topPadding + bottomPadding)) / numRows;

  console.log(
    "cellWidth",
    width,
    numCols,
    numRows,
    xSpacingBetween + rightPadding + leftPadding,
    cellWidth,
  );
  console.log("cellHeight", height, cellHeight);

  // will create 2D grid array
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const grid = {
        left: `${col * cellWidth + col * ((spaceBetweenCharts / width) * 100) + leftPadding}%`,
        top: `${row * cellHeight + row * ySpacingBetween + topPadding}%`,
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
