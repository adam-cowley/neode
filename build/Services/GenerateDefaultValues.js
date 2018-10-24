'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _ValidationError = require('../ValidationError');

var _ValidationError2 = _interopRequireDefault(_ValidationError);

var _CleanValue = require('./CleanValue');

var _CleanValue2 = _interopRequireDefault(_CleanValue);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function GenerateDefaultValuesAsync(neode, model, properties) {
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
        else if (typeof config.default !== "undefined") {
                output[key] = typeof config.default == 'function' ? config.default() : config.default;
            }

        // Clean Value
        if (output[key]) {
            output[key] = (0, _CleanValue2.default)(config, output[key]);
        }
    });

    return output;
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
    var output = GenerateDefaultValuesAsync(neode, model, properties);

    return Promise.resolve(output);
}

GenerateDefaultValues.async = GenerateDefaultValuesAsync;

exports.default = GenerateDefaultValues;