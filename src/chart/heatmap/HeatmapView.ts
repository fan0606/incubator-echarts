/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import {__DEV__} from '../../config';
import * as graphic from '../../util/graphic';
import HeatmapLayer from './HeatmapLayer';
import * as zrUtil from 'zrender/src/core/util';
import ChartView from '../../view/Chart';
import HeatmapSeriesModel, { HeatmapDataItemOption } from './HeatmapSeries';
import type GlobalModel from '../../model/Global';
import type ExtensionAPI from '../../ExtensionAPI';
import type VisualMapModel from '../../component/visualMap/VisualMapModel';
import type PiecewiseModel from '../../component/visualMap/PiecewiseModel';
import type ContinuousModel from '../../component/visualMap/ContinuousModel';
import { CoordinateSystem, isCoordinateSystemType } from '../../coord/CoordinateSystem';
import { StageHandlerProgressParams, Dictionary, OptionDataValue } from '../../util/types';
import type Cartesian2D from '../../coord/cartesian/Cartesian2D';
import type Calendar from '../../coord/calendar/Calendar';

// Coord can be 'geo' 'bmap' 'amap' 'leaflet'...
interface GeoLikeCoordSys extends CoordinateSystem {
    dimensions: ['lng', 'lat']
    getViewRect(): graphic.BoundingRect
}

function getIsInPiecewiseRange(
    dataExtent: number[],
    pieceList: ReturnType<PiecewiseModel['getPieceList']>,
    selected: Dictionary<boolean>
) {
    let dataSpan = dataExtent[1] - dataExtent[0];
    pieceList = zrUtil.map(pieceList, function (piece) {
        return {
            interval: [
                (piece.interval[0] - dataExtent[0]) / dataSpan,
                (piece.interval[1] - dataExtent[0]) / dataSpan
            ]
        };
    });
    let len = pieceList.length;
    let lastIndex = 0;

    return function (val: number) {
        let i;
        // Try to find in the location of the last found
        for (i = lastIndex; i < len; i++) {
            let interval = pieceList[i].interval;
            if (interval[0] <= val && val <= interval[1]) {
                lastIndex = i;
                break;
            }
        }
        if (i === len) { // Not found, back interation
            for (i = lastIndex - 1; i >= 0; i--) {
                let interval = pieceList[i].interval;
                if (interval[0] <= val && val <= interval[1]) {
                    lastIndex = i;
                    break;
                }
            }
        }
        return i >= 0 && i < len && selected[i];
    };
}

function getIsInContinuousRange(dataExtent: number[], range: number[]) {
    let dataSpan = dataExtent[1] - dataExtent[0];
    range = [
        (range[0] - dataExtent[0]) / dataSpan,
        (range[1] - dataExtent[0]) / dataSpan
    ];
    return function (val: number) {
        return val >= range[0] && val <= range[1];
    };
}

function isGeoCoordSys(coordSys: CoordinateSystem): coordSys is GeoLikeCoordSys {
    let dimensions = coordSys.dimensions;
    // Not use coorSys.type === 'geo' because coordSys maybe extended
    return dimensions[0] === 'lng' && dimensions[1] === 'lat';
}

class HeatmapView extends ChartView {

    static readonly type = 'heatmap';
    readonly type = HeatmapView.type;

    private _incrementalDisplayable: boolean;

    private _hmLayer: HeatmapLayer;

    render(seriesModel: HeatmapSeriesModel, ecModel: GlobalModel, api: ExtensionAPI) {
        let visualMapOfThisSeries;
        ecModel.eachComponent('visualMap', function (visualMap: VisualMapModel) {
            visualMap.eachTargetSeries(function (targetSeries) {
                if (targetSeries === seriesModel) {
                    visualMapOfThisSeries = visualMap;
                }
            });
        });

        if (__DEV__) {
            if (!visualMapOfThisSeries) {
                throw new Error('Heatmap must use with visualMap');
            }
        }

        this.group.removeAll();

        this._incrementalDisplayable = null;

        let coordSys = seriesModel.coordinateSystem;
        if (coordSys.type === 'cartesian2d' || coordSys.type === 'calendar') {
            this._renderOnCartesianAndCalendar(seriesModel, api, 0, seriesModel.getData().count());
        }
        else if (isGeoCoordSys(coordSys)) {
            this._renderOnGeo(
                coordSys, seriesModel, visualMapOfThisSeries, api
            );
        }
    }

    incrementalPrepareRender(seriesModel: HeatmapSeriesModel, ecModel: GlobalModel, api: ExtensionAPI) {
        this.group.removeAll();
    }

    incrementalRender(
        params: StageHandlerProgressParams,
        seriesModel: HeatmapSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI
    ) {
        let coordSys = seriesModel.coordinateSystem;
        if (coordSys) {
            this._renderOnCartesianAndCalendar(seriesModel, api, params.start, params.end, true);
        }
    }

    _renderOnCartesianAndCalendar(
        seriesModel: HeatmapSeriesModel,
        api: ExtensionAPI,
        start: number,
        end: number,
        incremental?: boolean
    ) {

        let coordSys = seriesModel.coordinateSystem as Cartesian2D | Calendar;
        let width;
        let height;

        if (isCoordinateSystemType<Cartesian2D>(coordSys, 'cartesian2d')) {
            let xAxis = coordSys.getAxis('x');
            let yAxis = coordSys.getAxis('y');

            if (__DEV__) {
                if (!(xAxis.type === 'category' && yAxis.type === 'category')) {
                    throw new Error('Heatmap on cartesian must have two category axes');
                }
                if (!(xAxis.onBand && yAxis.onBand)) {
                    throw new Error('Heatmap on cartesian must have two axes with boundaryGap true');
                }
            }

            width = xAxis.getBandWidth();
            height = yAxis.getBandWidth();
        }

        let group = this.group;
        let data = seriesModel.getData();

        let style = seriesModel.getModel('itemStyle').getItemStyle(['color']);
        let hoverStl = seriesModel.getModel(['emphasis', 'itemStyle']).getItemStyle();
        let labelModel = seriesModel.getModel('label');
        let hoverLabelModel = seriesModel.getModel(['emphasis', 'label']);

        let dataDims = isCoordinateSystemType<Cartesian2D>(coordSys, 'cartesian2d')
            ? [
                data.mapDimension('x'),
                data.mapDimension('y'),
                data.mapDimension('value')
            ]
            : [
                data.mapDimension('time'),
                data.mapDimension('value')
            ];

        for (let idx = start; idx < end; idx++) {
            let rect;

            if (isCoordinateSystemType<Cartesian2D>(coordSys, 'cartesian2d')) {
                // Ignore empty data
                if (isNaN(data.get(dataDims[2], idx) as number)) {
                    continue;
                }

                let point = coordSys.dataToPoint([
                    data.get(dataDims[0], idx),
                    data.get(dataDims[1], idx)
                ]);

                rect = new graphic.Rect({
                    shape: {
                        x: Math.floor(point[0] - width / 2),
                        y: Math.floor(point[1] - height / 2),
                        width: Math.ceil(width),
                        height: Math.ceil(height)
                    },
                    style: {
                        fill: data.getItemVisual(idx, 'color'),
                        opacity: data.getItemVisual(idx, 'opacity')
                    }
                });
            }
            else {
                // Ignore empty data
                if (isNaN(data.get(dataDims[1], idx) as number)) {
                    continue;
                }

                rect = new graphic.Rect({
                    z2: 1,
                    shape: coordSys.dataToRect([data.get(dataDims[0], idx)]).contentShape,
                    style: {
                        fill: data.getItemVisual(idx, 'color'),
                        opacity: data.getItemVisual(idx, 'opacity')
                    }
                });
            }

            let itemModel = data.getItemModel<HeatmapDataItemOption>(idx);

            // Optimization for large datset
            if (data.hasItemOption) {
                style = itemModel.getModel('itemStyle').getItemStyle(['color']);
                hoverStl = itemModel.getModel(['emphasis', 'itemStyle']).getItemStyle();
                labelModel = itemModel.getModel('label');
                hoverLabelModel = itemModel.getModel(['emphasis', 'label']);
            }

            let rawValue = seriesModel.getRawValue(idx) as OptionDataValue[];
            let defaultText = '-';
            if (rawValue && rawValue[2] != null) {
                defaultText = rawValue[2] + '';
            }

            graphic.setLabelStyle(
                style, hoverStl, labelModel, hoverLabelModel,
                {
                    labelFetcher: seriesModel,
                    labelDataIndex: idx,
                    defaultText: defaultText,
                    isRectText: true
                }
            );

            rect.setStyle(style);
            graphic.setHoverStyle(rect, data.hasItemOption ? hoverStl : zrUtil.extend({}, hoverStl));

            rect.incremental = incremental;
            // PENDING
            if (incremental) {
                // Rect must use hover layer if it's incremental.
                rect.useHoverLayer = true;
            }

            group.add(rect);
            data.setItemGraphicEl(idx, rect);
        }
    }

    _renderOnGeo(
        geo: GeoLikeCoordSys,
        seriesModel: HeatmapSeriesModel,
        visualMapModel: VisualMapModel,
        api: ExtensionAPI
    ) {
        let inRangeVisuals = visualMapModel.targetVisuals.inRange;
        let outOfRangeVisuals = visualMapModel.targetVisuals.outOfRange;
        // if (!visualMapping) {
        //     throw new Error('Data range must have color visuals');
        // }

        let data = seriesModel.getData();
        let hmLayer = this._hmLayer || (this._hmLayer || new HeatmapLayer());
        hmLayer.blurSize = seriesModel.get('blurSize');
        hmLayer.pointSize = seriesModel.get('pointSize');
        hmLayer.minOpacity = seriesModel.get('minOpacity');
        hmLayer.maxOpacity = seriesModel.get('maxOpacity');

        let rect = geo.getViewRect().clone();
        let roamTransform = geo.getRoamTransform();
        rect.applyTransform(roamTransform);

        // Clamp on viewport
        let x = Math.max(rect.x, 0);
        let y = Math.max(rect.y, 0);
        let x2 = Math.min(rect.width + rect.x, api.getWidth());
        let y2 = Math.min(rect.height + rect.y, api.getHeight());
        let width = x2 - x;
        let height = y2 - y;

        let dims = [
            data.mapDimension('lng'),
            data.mapDimension('lat'),
            data.mapDimension('value')
        ];

        let points = data.mapArray(dims, function (lng: number, lat: number, value: number) {
            let pt = geo.dataToPoint([lng, lat]);
            pt[0] -= x;
            pt[1] -= y;
            pt.push(value);
            return pt;
        });

        let dataExtent = visualMapModel.getExtent();
        let isInRange = visualMapModel.type === 'visualMap.continuous'
            ? getIsInContinuousRange(dataExtent, (visualMapModel as ContinuousModel).option.range)
            : getIsInPiecewiseRange(
                dataExtent,
                (visualMapModel as PiecewiseModel).getPieceList(),
                (visualMapModel as PiecewiseModel).option.selected
            );

        hmLayer.update(
            points, width, height,
            inRangeVisuals.color.getNormalizer(),
            {
                inRange: inRangeVisuals.color.getColorMapper(),
                outOfRange: outOfRangeVisuals.color.getColorMapper()
            },
            isInRange
        );
        let img = new graphic.Image({
            style: {
                width: width,
                height: height,
                x: x,
                y: y,
                image: hmLayer.canvas
            },
            silent: true
        });
        this.group.add(img);
    }
}

ChartView.registerClass(HeatmapView);

export default HeatmapView;