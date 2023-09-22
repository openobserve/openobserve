import { ComponentView, getInstanceByDom, throttle } from 'echarts/core';
import { clearLogMap } from './helper';

const LeafletView = {
  type: 'lmap',

  init() {
    this._isFirstRender = true;
  },

  render(lmapModel, ecModel, api) {
    let rendering = true;

    const lmap = lmapModel.getLeaflet();
    const moveContainer = api.getZr().painter.getViewportRoot().parentNode;
    const coordSys = lmapModel.coordinateSystem;
    const offsetEl = lmap._mapPane;

    const renderOnMoving = lmapModel.get('renderOnMoving');
    const resizeEnable = lmapModel.get('resizeEnable');
    const largeMode = lmapModel.get('largeMode');

    let moveHandler = function(e) {
      if (rendering) {
        return;
      }
      let transformStyle = offsetEl.style.transform;
      let dx = 0;
      let dy = 0;
      if (transformStyle) {
        transformStyle = transformStyle.replace('translate3d(', '');
        let parts = transformStyle.split(',');
        dx = -parseInt(parts[0], 10);
        dy = -parseInt(parts[1], 10);
      } else {
        // browsers that don't support transform: matrix
        dx = -parseInt(offsetEl.style.left, 10);
        dy = -parseInt(offsetEl.style.top, 10);
      }

      const mapOffset = [dx, dy];
      const offsetLeft = mapOffset[0] + 'px';
      const offsetTop = mapOffset[1] + 'px';
      if (moveContainer.style.left !== offsetLeft) {
        moveContainer.style.left = offsetLeft;
      }
      if (moveContainer.style.top !== offsetTop) {
        moveContainer.style.top = offsetTop;
      }

      coordSys.setMapOffset(lmapModel.__mapOffset = mapOffset);

      const actionParams = {
        type: 'lmapRoam',
        animation: {
          // compatible with ECharts 5.x
          // no delay for rendering but remain animation of elements
          duration: 0
        }
      };

      api.dispatchAction(actionParams);
    };

    if(largeMode) {
      moveHandler = throttle(moveHandler, 20, true);
    }

    if(this._isFirstRender){
      this._moveHandler = moveHandler;
    }

    let ctrlStartHandler = function(e) {
      if(e.originalEvent.code === 'ControlLeft') {
      lmap.dragging.disable();
      moveHandler(e);
      }
    };

    let ctrlEndHandler = function(e) {
      if(e.originalEvent.code === 'ControlLeft') {
        lmap.dragging.enable();
      }
    };

    this._ctrlStartHandler = ctrlStartHandler;
    this._ctrlEndHandler = ctrlEndHandler;

    lmap.off('move', this._moveHandler);
    lmap.off('moveend', this._moveHandler);
    lmap.off('zoom', this._moveHandler);
    lmap.off('viewreset', this._moveHandler);
    lmap.off('zoomend', this._moveHandler);
    lmap.off('keydown', this._ctrlStartHandler);
    lmap.off('keyup', this._ctrlEndHandler);

    if(this._ctrlStartHandler) {
      lmap.off('keydown', this._ctrlStartHandler);
    }

    if(this._ctrlEndHandler) {
      lmap.off('keyup', this._ctrlEndHandler);
    }

    if (this._resizeHandler) {
      lmap.off('resize', this._resizeHandler);
    }
    if (this._moveStartHandler) {
      lmap.off('move', this._moveStartHandler);
      lmap.off('zoomstart', this._moveStartHandler);
      lmap.off('zoom', this._moveStartHandler);
    }

    lmap.on(renderOnMoving ? 'move' : 'moveend', moveHandler);
    lmap.on(renderOnMoving ? 'zoom' : 'zoomend', moveHandler);

    if(renderOnMoving){
      lmap.on('viewreset', moveHandler); // needed?
    }

    if(!renderOnMoving && !this._moveEndHandler) {
      const moveEndHandler = function(e) {
        setTimeout(function() {
          lmapModel.setEChartsLayerVisiblity(true);
        }, !largeMode ? 0 : 20);
      };
      this._moveEndHandler = moveEndHandler;
      lmap.on('moveend', moveEndHandler);
      lmap.on('zoomend', moveEndHandler);
    }

    lmap.on('keydown', ctrlStartHandler);
    lmap.on('keyup', ctrlEndHandler);

    this._moveHandler = moveHandler;

    if (!renderOnMoving) {
      const moveStartHandler = function() {
        lmapModel.setEChartsLayerVisiblity(false);
        setTimeout(function() {
          lmapModel.setEChartsLayerVisiblity(true);
        }, 500);
      };
      this._moveStartHandler = moveStartHandler;
      lmap.on('move', moveStartHandler); // hide when move occurs
      lmap.on('zoomstart', moveStartHandler); // hide when zoom starts
      lmap.on('zoom', moveStartHandler); // hide when zoom occurs
    }

    if (resizeEnable) {
      let resizeHandler = function() {
        getInstanceByDom(api.getDom()).resize();
      };
      if (largeMode) {
        resizeHandler = throttle(resizeHandler, 20, true);
      }
      this._resizeHandler = resizeHandler;
      lmap.on('resize', resizeHandler);
    }

    this._isFirstRender = rendering = false;
  },

  dispose() {
    clearLogMap();
    const component = this.__model;
    if (component) {
      const leaflet = component.getLeaflet();
      if(leaflet){
        component.getLeaflet().off();
        component.getLeaflet().remove();
      }
      component.setLeaflet(null);
      component.setEChartsLayer(null);
      if (component.coordinateSystem) {
        component.coordinateSystem.setLeaflet(null);
        component.coordinateSystem = null;
      }
      delete this._moveHandler;
      delete this._resizeHandler;
      delete this._moveStartHandler;
      delete this._moveEndHandler;
      delete this._ctrlEndHandler;
      delete this._ctrlStartHandler;
    }
  }
};

export default ComponentView.extend(LeafletView);
