/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import _ from 'lodash';
import React from 'react';
import { ALayer } from './layer';
import { EuiIcon } from '@elastic/eui';
import { HeatmapStyle } from './styles/heatmap_style';
import { ZOOM_TO_PRECISION } from '../utils/zoom_to_precision';

export class HeatmapLayer extends ALayer {

  static type = "HEATMAP";

  static createDescriptor(options) {
    const heatmapLayerDescriptor = super.createDescriptor(options);
    heatmapLayerDescriptor.type = HeatmapLayer.type;
    const defaultStyle = HeatmapStyle.createDescriptor('coarse');
    heatmapLayerDescriptor.style = defaultStyle;
    return heatmapLayerDescriptor;
  }

  constructor({ layerDescriptor, source, style }) {
    super({ layerDescriptor, source, style });
    if (!style) {
      const defaultStyle = HeatmapStyle.createDescriptor('coarse');
      this._style = new HeatmapStyle(defaultStyle);
    }
  }

  getSupportedStyles() {
    return [HeatmapStyle];
  }

  syncLayerWithMB(mbMap) {

    const mbSource = mbMap.getSource(this.getId());
    const heatmapLayerId = this.getId() + '_heatmap';

    if (!mbSource) {
      mbMap.addSource(this.getId(), {
        type: 'geojson',
        data: { 'type': 'FeatureCollection', 'features': [] }
      });


      mbMap.addLayer({
        id: heatmapLayerId,
        type: 'heatmap',
        source: this.getId(),
        paint: {}
      });
    }

    const mbSourceAfter = mbMap.getSource(this.getId());
    const sourceDataRequest = this.getSourceDataRequest();
    const featureCollection = sourceDataRequest ? sourceDataRequest.getData() : null;
    if (!featureCollection) {
      mbSourceAfter.setData({ 'type': 'FeatureCollection', 'features': [] });
      return;
    }

    const scaledPropertyName = '__kbn_heatmap_weight__';
    const propertyName = 'doc_count';
    const dataBoundToMap = ALayer.getBoundDataForSource(mbMap, this.getId());
    if (featureCollection !== dataBoundToMap) {
      let max = 0;
      for (let i = 0; i < featureCollection.features.length; i++) {
        max = Math.max(featureCollection.features[i].properties[propertyName], max);
      }
      for (let i = 0; i < featureCollection.features.length; i++) {
        featureCollection.features[i].properties[scaledPropertyName] = featureCollection.features[i].properties[propertyName] / max;
      }
      mbSourceAfter.setData(featureCollection);
    }

    mbMap.setLayoutProperty(heatmapLayerId, 'visibility', this.isVisible() ? 'visible' : 'none');
    this._style.setMBPaintProperties(mbMap, heatmapLayerId, scaledPropertyName);
    mbMap.setLayerZoomRange(heatmapLayerId, this._descriptor.minZoom, this._descriptor.maxZoom);
  }


  async syncData({ startLoading, stopLoading, onLoadError, dataFilters }) {
    if (!this.isVisible() || !this.showAtZoomLevel(dataFilters.zoom)) {
      return;
    }

    if (!dataFilters.buffer) {
      return;
    }

    const sourceDataRequest = this.getSourceDataRequest();
    const dataMeta = sourceDataRequest ? sourceDataRequest.getMeta() : {};

    const targetPrecision = ZOOM_TO_PRECISION[Math.round(dataFilters.zoom)] + this._style.getPrecisionRefinementDelta();
    const isSamePrecision = dataMeta.precision === targetPrecision;

    const isSameTime = _.isEqual(dataMeta.timeFilters, dataFilters.timeFilters);

    const updateDueToRefreshTimer = dataFilters.refreshTimerLastTriggeredAt
      && !_.isEqual(dataMeta.refreshTimerLastTriggeredAt, dataFilters.refreshTimerLastTriggeredAt);

    const updateDueToExtent = this.updateDueToExtent(this._source, dataMeta, dataFilters);


    if (isSamePrecision && isSameTime && !updateDueToExtent && !updateDueToRefreshTimer) {
      return;
    }

    const newDataMeta = {
      ...dataFilters,
      precision: targetPrecision
    };
    return this._fetchNewData({ startLoading, stopLoading, onLoadError, dataMeta: newDataMeta });
  }

  async _fetchNewData({ startLoading, stopLoading, onLoadError, dataMeta }) {
    const { precision, timeFilters, buffer } = dataMeta;
    const requestToken = Symbol(`layer-source-refresh: this.getId()`);
    startLoading('source', requestToken, dataMeta);
    try {
      const layerName = await this.getDisplayName();
      const data = await this._source.getGeoJsonPointsWithTotalCount({
        precision,
        extent: buffer,
        timeFilters,
        layerName,
      });
      stopLoading('source', requestToken, data);
    } catch (error) {
      onLoadError('source', requestToken, error.message);
    }
  }

  getIcon() {
    return (
      <EuiIcon
        type={'heatmap'}
      />
    );
  }

}
