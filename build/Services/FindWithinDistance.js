'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = FindWithinDistance;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _Factory = require('../Factory');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function FindWithinDistance(neode, model, location_property, point, distance, properties, order, limit, skip) {
    var _builder$orderBy$skip;

    var alias = 'this';
    var output = [alias];

    // Prefix key on Properties
    if (properties) {
        Object.keys(properties).forEach(function (key) {
            properties[alias + '.' + key] = properties[key];

            delete properties[key];
        });
    }

    // Prefix key on Order
    if (typeof order == 'string') {
        order = alias + '.' + order;
    } else if ((typeof order === 'undefined' ? 'undefined' : _typeof(order)) == 'object') {
        Object.keys(order).forEach(function (key) {
            order[alias + '.' + key] = order[key];

            delete order[key];
        });
    }

    var builder = new _Builder2.default(neode);
    var pointString = isNaN(point.x) ? 'latitude:' + point.latitude + ', longitude:' + point.longitude : 'x:' + point.x + ', y:' + point.y;
    if (!isNaN(point.z)) pointString += ', z:' + point.z;
    if (!isNaN(point.height)) pointString += ', height:' + point.height;

    // Match
    builder.match(alias, model)
    // TODO When properties are passed match them as well .where(properties);
    .where('distance (this.' + location_property + ', point({' + pointString + '})) <= ' + distance);

    // Load Eager Relationships
    model.eager().forEach(function (relationship) {
        var key = '' + _Factory.eager + relationship.type();

        builder.optionalMatch(alias).relationship(relationship.relationship(), relationship.direction()).to(key, relationship.target());

        output.push('COLLECT(' + key + ') as ' + key);
    });

    // Complete Query
    (_builder$orderBy$skip = builder.orderBy(order).skip(skip).limit(limit)).return.apply(_builder$orderBy$skip, output);

    return builder.execute(_Builder.mode.READ).then(function (res) {
        return neode.hydrate(res, alias);
    });
}