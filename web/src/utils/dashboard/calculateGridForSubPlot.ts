// it is used to create grid array for gauge chart
export function calculateGridPositions(width: any, height: any, numGrids: any) {
  const gridArray: any = [];

  // if no grid then return empty array
  if (numGrids <= 0) {
    return gridArray;
  }

  // if only one grid then return single grid array, width, height, gridNoOfRow, gridNoOfCol
  if (numGrids == 1) {
    return {
      gridArray: [
        {
          left: "0%",
          top: "0%",
          width: "100%",
          height: "100%",
        },
      ],
      gridWidth: width,
      gridHeight: height,
      gridNoOfRow: 1,
      gridNoOfCol: 1,
    };
  }

  // total area of chart element
  const totalArea = width * height;
  // per gauge area
  // chart will be square, so width and height are same, that's why used sqrt
  const perChartArea = Math.sqrt(totalArea / numGrids);
  // number of row and column for gauge rendering
  let numRows = Math.ceil(height / perChartArea);
  let numCols = Math.ceil(width / perChartArea);

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