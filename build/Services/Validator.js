'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = Validator;

var _joi = require('joi');

var _joi2 = _interopRequireDefault(_joi);

var _Node = require('../Node');

var _Node2 = _interopRequireDefault(_Node);

var _ValidationError = require('../ValidationError');

var _ValidationError2 = _interopRequireDefault(_ValidationError);

var _neo4jDriver = require('neo4j-driver');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var joi_options = {
    allowUnknown: true,
    abortEarly: false
};

var ignore = ['type', 'default'];
var booleans = ['optional', 'forbidden', 'strip', 'positive', 'negative', 'port', 'integer', 'iso', 'isoDate', 'insensitive', 'required', 'truncate', 'creditCard', 'alphanum', 'token', 'hex', 'hostname', 'lowercase', 'uppercase'];
var booleanOrOptions = ['email', 'ip', 'uri', 'base64', 'normalize', 'hex'];

var temporal = _joi2.default.extend({
    base: _joi2.default.object(),
    name: 'temporal',
    language: {
        before: 'Value before minimum expected value',
        after: 'Value after minimum expected value'
    },
    rules: [{
        name: 'after',
        params: {
            after: _joi2.default.alternatives([_joi2.default.date(), _joi2.default.string()])
        },
        validate: function validate(params, value, state, options) {
            if (params.after === 'now') {
                params.after = new Date();
            }

            if (params.after > value) {
                return this.createError('temporal.after', { v: value }, state, options);
            }

            return value;
        }
    }, {
        name: 'before',
        params: {
            after: _joi2.default.alternatives([_joi2.default.date(), _joi2.default.string()])
        },
        validate: function validate(params, value, state, options) {
            if (params.after === 'now') {
                params.after = new Date();
            }

            if (params.after < value) {
                return this.createError('temporal.after', { v: value }, state, options);
            }

            return value;
        }
    }]

});

function BuildValidationSchema(model) {
    var schema = model.schema();
    var output = {};

    Object.keys(schema).forEach(function (key) {
        var config = typeof schema[key] == 'string' ? { type: schema[key] } : schema[key];

        var validation = false;

        switch (config.type) {
            // TODO: Recursive creation, validate nodes and relationships
            case 'node':
                validation = _joi2.default.alternatives([_joi2.default.object().type(_Node2.default), _joi2.default.string(), _joi2.default.number(), _joi2.default.object()]);
                break;

            case 'uuid':
                validation = _joi2.default.string().guid({ version: 'uuidv4' });
                break;

            case 'string':
            case 'number':
            case 'boolean':
                validation = _joi2.default[config.type]();
                break;

            case 'datetime':
                validation = temporal.temporal().type(_neo4jDriver.v1.types.DateTime);
                break;

            case 'date':
                validation = temporal.temporal().type(_neo4jDriver.v1.types.Date);
                break;

            case 'time':
                validation = temporal.temporal().type(_neo4jDriver.v1.types.Time);
                break;

            case 'localdate':
                validation = temporal.temporal().type(_neo4jDriver.v1.types.LocalDate);
                break;

            case 'localtime':
                validation = temporal.temporal().type(_neo4jDriver.v1.types.LocalTime);
                break;

            case 'int':
            case 'integer':
                validation = _joi2.default.number().integer();
                break;

            case 'float':
                validation = _joi2.default.number();
                break;

            default:
                validation = _joi2.default.any();
                break;
        }

        // Apply additional Validation
        Object.keys(config).forEach(function (validator) {
            var options = config[validator];

            if (validator == 'regex') {
                if (options instanceof RegExp) {
                    validation = validation.regex(options);
                } else {
                    var pattern = options.pattern;
                    delete options.pattern;

                    validation = validation.regex(pattern, options);
                }
            } else if (validator == 'replace') {
                validation = validation.replace(options.pattern, options.replace);
            } else if (booleanOrOptions.indexOf(validator) > -1) {
                if ((typeof options === 'undefined' ? 'undefined' : _typeof(options)) == 'object') {
                    validation = validation[validator](options);
                } else if (options) {
                    validation = validation[validator]();
                }
            } else if (booleans.indexOf(validator) > -1) {
                if (options === true) {
                    validation = validation[validator](options);
                }
            } else if (ignore.indexOf(validator) == -1 && validation[validator]) {
                validation = validation[validator](options);
            }
        });

        output[key] = validation;
    });

    return output;
}

/**
 * Run Validation
 * 
 * TODO: Recursive Validation
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
                return reject(err);
            }

            return resolve(validated);
        });
    });
}