'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = GenerateDefaultValues;

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

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