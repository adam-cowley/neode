'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = GenerateDefaultValues;

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _neo4jDriver = require('neo4j-driver');

var _ValidationError = require('../ValidationError');

var _ValidationError2 = _interopRequireDefault(_ValidationError);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Convert a value to it's native type
 *
 * @param  {Object} config   Field Configuration
 * @param  {mixed}  value    Value to be converted
 * @return {mixed}
 */
function CleanValue(config, value) {
    // Clean Values
    switch (config.type) {
        case 'float':
            value = parseFloat(value);
            break;

        case 'int':
        case 'integer':
            value = parseInt(value);
            break;

        case 'bool':
        case 'boolean':
            value = !!value;
            break;

        case 'timestamp':
            value = value instanceof Date ? value.getTime() : value;
            break;

        case 'DateTime':
            value = value instanceof Date ? new _neo4jDriver.v1.types.DateTime(value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds() * 1000000, // nanoseconds
            value.getTimezoneOffset() * 60 // seconds
            ) : value;
            break;

        case 'Point':
            // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
            if (isNaN(value.x)) {
                // WGS 84
                if (isNaN(value.height)) {
                    value = new _neo4jDriver.v1.types.Point(4326, // WGS 84 2D
                    value.longitude, value.latitude);
                } else {
                    value = new _neo4jDriver.v1.types.Point(4979, // WGS 84 3D
                    value.longitude, value.latitude, value.height);
                }
            } else {
                if (isNaN(value.z)) {
                    value = new _neo4jDriver.v1.types.Point(7203, // Cartesian 2D
                    value.x, value.y);
                } else {
                    value = new _neo4jDriver.v1.types.Point(9157, // Cartesian 3D
                    value.x, value.y, value.z);
                }
            }
            break;
    }

    return value;
}

/**
 * Generate default values where no values are not currently set.
 *
 * @param  {Neode}  neode
 * @param  {Model}  model
 * @param  {Object} properties
 * @return {Promise}
 */
function GenerateDefaultValues(neode, model, properties) {
    var schema = model.schema();
    var output = {};

    if (!(properties instanceof Object)) {
        throw new _ValidationError2.default('`properties` must be an object.', properties);
    }

    // Get All Config
    Object.keys(schema).forEach(function (key) {
        var config = typeof schema[key] == 'string' ? { type: schema[key] } : schema[key];

        switch (config.type) {
            case 'uuid':
                config.default = _uuid2.default.v4;
                break;
        }

        if (properties.hasOwnProperty(key)) {
            output[key] = properties[key];
        }

        // Set Default Value
        else if (config.default) {
                output[key] = typeof config.default == 'function' ? config.default() : config.default;
            }

        // Clean Value
        if (output[key]) {
            output[key] = CleanValue(config, output[key]);
        }
    });

    return Promise.resolve(output);
}