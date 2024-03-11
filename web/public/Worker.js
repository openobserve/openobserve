import {
  formatDate,
  formatUnitValue,
  getUnitValue,
} from "./../src/utils/dashboard/convertDataIntoUnitValue";

onmessage = (event) => {
  const { hoveredSeriesState, panelSchema, name } = event.data;
  if (
    hoveredSeriesState?.value &&
    panelSchema.id &&
    hoveredSeriesState?.value?.panelId != panelSchema.id
  )
    return postMessage("");
  if (name.length == 0) return postMessage("");

  const date = new Date(name[0].data[0]);

  // if hovered series is not null
  // then swap the hovered series to top in tooltip
  if (hoveredSeriesState?.value?.hoveredSeriesName) {
    // get the current series index from name
    const currentSeriesIndex = name.findIndex(
      (it) => it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
    );

    // swap current hovered series index to top in tooltip
    if (currentSeriesIndex != -1) {
      const temp = name[0];
      name[0] = name[currentSeriesIndex];
      name[currentSeriesIndex] = temp;
    }
  }

  let hoverText = name.map((it) => {
    // check if the series is the current series being hovered
    // if have than bold it
    if (it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName)
      return `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
        getUnitValue(
          it.data[1],
          panelSchema.config?.unit,
          panelSchema.config?.unit_custom,
          panelSchema.config?.decimals
        )
      )} </strong>`;
    // else normal text
    else
      return `${it.marker} ${it.seriesName} : ${formatUnitValue(
        getUnitValue(
          it.data[1],
          panelSchema.config?.unit,
          panelSchema.config?.unit_custom,
          panelSchema.config?.decimals
        )
      )}`;
  });

  postMessage(`${formatDate(date)} <br/> ${hoverText.join("<br/>")}`);
};
