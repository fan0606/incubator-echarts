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

import * as zrUtil from 'zrender/src/core/util';
import GlobalModel from '../../model/Global';
import RadarSeriesModel from './RadarSeries';
import Radar from '../../coord/radar/Radar';

type Point = number[];
export default function (ecModel: GlobalModel) {
    ecModel.eachSeriesByType('radar', function (seriesModel: RadarSeriesModel) {
        let data = seriesModel.getData();
        let points: Point[][] = [];
        let coordSys = seriesModel.coordinateSystem;
        if (!coordSys) {
            return;
        }

        let axes = coordSys.getIndicatorAxes();

        zrUtil.each(axes, function (axis, axisIndex) {
            data.each(data.mapDimension(axes[axisIndex].dim), function (val, dataIndex) {
                points[dataIndex] = points[dataIndex] || [];
                let point = coordSys.dataToPoint(val, axisIndex);
                points[dataIndex][axisIndex] = isValidPoint(point)
                    ? point : getValueMissingPoint(coordSys);
            });
        });

        // Close polygon
        data.each(function (idx) {
            // TODO
            // Is it appropriate to connect to the next data when some data is missing?
            // Or, should trade it like `connectNull` in line chart?
            let firstPoint = zrUtil.find(points[idx], function (point) {
                return isValidPoint(point);
            }) || getValueMissingPoint(coordSys);

            // Copy the first actual point to the end of the array
            points[idx].push(firstPoint.slice());
            data.setItemLayout(idx, points[idx]);
        });
    });
}

function isValidPoint(point: Point) {
    return !isNaN(point[0]) && !isNaN(point[1]);
}

function getValueMissingPoint(coordSys: Radar): Point {
    // It is error-prone to input [NaN, NaN] into polygon, polygon.
    // (probably cause problem when refreshing or animating)
    return [coordSys.cx, coordSys.cy];
}