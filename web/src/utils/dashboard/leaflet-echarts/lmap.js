/**
 * Leaflet component extension
 */

import LeafletCoordSys from './LeafletCoordSys';
import LeafletModel from './LeafletModel';
import LeafletView from './LeafletView';

import { ecVer } from "./helper";

function install(registers) {

  // add coordinate system support for pie series for ECharts < 5.4.0
  if ((ecVer[0] == 5 && ecVer[1] < 4)) {
    registers.registerLayout(function(ecModel, api) {
      ecModel.eachSeriesByType('pie', function (seriesModel) {
        const coordSys = seriesModel.coordinateSystem;
        const data = seriesModel.getData();
        const valueDim = data.mapDimension('value');
        if (coordSys && coordSys.type === 'lmap') {
          const center = seriesModel.get('center');
          const point = coordSys.dataToPoint(center);
          const cx = point[0];
          const cy = point[1];
          data.each(valueDim, function (value, idx) {
            const layout = data.getItemLayout(idx);
            layout.cx = cx;
            layout.cy = cy;
          });
        }
      });
    });
  }

  registers.registerComponentModel(LeafletModel);
  registers.registerComponentView(LeafletView);
  registers.registerCoordinateSystem('lmap', LeafletCoordSys);

  // Action
  registers.registerAction(
    {
      type: 'lmapRoam',
      event: 'lmapRoam',
      update: 'updateLayout'
    },
    function(payload, ecModel) {
      ecModel.eachComponent('lmap', function(lmapModel) {
        const lmap = lmapModel.getLeaflet();
        const center = lmap.getCenter();
        lmapModel.setCenterAndZoom([center.lat, center.lng], lmap.getZoom());
      });
    }
  );
}

export {install as LeafletComponent}
