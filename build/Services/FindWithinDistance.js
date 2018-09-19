'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = FindWithinDistance;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _EagerUtils = require('../Query/EagerUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function FindWithinDistance(neode, model, location_property, point, distance, properties, order, limit, skip) {
    var alias = 'this';

    var builder = new _Builder2.default(neode);

    // Match
    builder.match(alias, model);

    // Where
    if (properties) {
        Object.keys(properties).forEach(function (key) {
            builder.where(alias + '.' + key, properties[key]);
        });
    }

    // Prefix key on Properties
    if (properties) {
        Object.keys(properties).forEach(function (key) {
            properties[alias + '.' + key] = properties[key];

            delete properties[key];
        });
    }

    // Distance from Point
    // TODO: When properties are passed match them as well .where(properties);
    var pointString = isNaN(point.x) ? 'latitude:' + point.latitude + ', longitude:' + point.longitude : 'x:' + point.x + ', y:' + point.y;
    if (!isNaN(point.z)) {
        pointString += ', z:' + point.z;
    }

    if (!isNaN(point.height)) {
        pointString += ', height:' + point.height;
    }

    builder.whereRaw('distance (this.' + location_property + ', point({' + pointString + '})) <= ' + distance);

    // Order
    if (typeof order == 'string') {
        order = alias + '.' + order;
    } else if ((typeof order === 'undefined' ? 'undefined' : _typeof(order)) == 'object') {
        Object.keys(order).forEach(function (key) {
            builder.orderBy(alias + '.' + key, order[key]);
        });
    }

    // Output
    var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model);

    // Complete Query
    return builder.orderBy(order).skip(skip).limit(limit).return(output).execute(_Builder.mode.READ).then(function (res) {
        return neode.hydrate(res, alias);
    });
}