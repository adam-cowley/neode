'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Validator;

var _joi = require('joi');

var _joi2 = _interopRequireDefault(_joi);

var _Model = require('../Model');

var _Model2 = _interopRequireDefault(_Model);

var _ValidationError = require('../ValidationError');

var _ValidationError2 = _interopRequireDefault(_ValidationError);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var joi_options = {
    allowUnknown: true,
    abortEarly: false
};

function BuildValidationSchema(model) {
    var schema = model.schema();
    var output = {};

    Object.keys(schema).forEach(function (key) {
        var config = typeof schema[key] == 'string' ? { type: schema[key] } : schema[key];

        // Remove Default
        // delete config.type;
        // delete config.default;

        var validation = false;

        switch (config.type) {
            case 'node':
                validation = _joi2.default.object().type(_Model2.default);
                break;

            case 'uuid':
                validation = _joi2.default.string();
                break;

            //  TODO: Support more types
            case 'string':
            case 'number':
            case 'boolean':
                validation = _joi2.default[config.type]();
                break;

            default:
                validation = _joi2.default.any();
                break;
        }

        // Apply additional Validation
        var ignore = ['type', 'default'];
        Object.keys(config).forEach(function (validator) {
            if (ignore.indexOf(validator) == -1 && validation[validator]) {
                validation = validation[validator](config[validator]);
            }
        });

        output[key] = validation;
    });

    return output;
}

/**
 * Run Validation
 *
 * @param  {Neode} neode
 * @param  {Model} model
 * @param  {Object} properties
 * @return {Promise}
 */
function Validator(neode, model, properties) {
    var schema = BuildValidationSchema(model, properties);

    return new Promise(function (resolve, reject) {
        _joi2.default.validate(properties, schema, joi_options, function (err, validated) {
            if (err) {
                var errors = {};

                err.details.forEach(function (e) {
                    if (!errors[e.path]) {
                        errors[e.path] = [];
                    }

                    errors[e.path].push(e.type);
                });

                return reject(new _ValidationError2.default(errors));
            }

            resolve(validated);
        });
    });
}
module.exports = exports['default'];