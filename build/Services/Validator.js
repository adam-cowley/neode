'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = Validator;

var _joi = require('@hapi/joi');

var _joi2 = _interopRequireDefault(_joi);

var _Model = require('../Model');

var _Model2 = _interopRequireDefault(_Model);

var _Node = require('../Node');

var _Node2 = _interopRequireDefault(_Node);

var _RelationshipType = require('../RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

var _ValidationError = require('../ValidationError');

var _ValidationError2 = _interopRequireDefault(_ValidationError);

var _neo4jDriver = require('neo4j-driver');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; } /* eslint-disable no-case-declarations */


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

// {
//     lat: Joi.number(),
//     long: Joi.number()
//   }).and('lat', 'long')

var point = _joi2.default.extend({
    base: _joi2.default.object().keys({
        latitude: _joi2.default.number().required(),
        longitude: _joi2.default.number().required(),
        height: _joi2.default.number().optional()
    }).and('latitude', 'longitude'),
    name: 'point'
});

function nodeSchema() {
    return _joi2.default.alternatives([_joi2.default.object().type(_Node2.default), _joi2.default.string(), _joi2.default.number(), _joi2.default.object()]);
}

function relationshipSchema(alias) {
    var properties = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    return _joi2.default.object().keys(Object.assign({}, _defineProperty({}, alias, nodeSchema().required()), BuildValidationSchema(properties)));
}

function BuildValidationSchema(schema) {
    if (schema instanceof _Model2.default || schema instanceof _RelationshipType2.default) {
        schema = schema.schema();
    }

    var output = {};

    Object.keys(schema).forEach(function (key) {
        var config = typeof schema[key] == 'string' ? { type: schema[key] } : schema[key];

        var validation = false;

        switch (config.type) {
            // TODO: Recursive creation, validate nodes and relationships
            case 'node':
                validation = nodeSchema();
                break;

            case 'nodes':
                validation = _joi2.default.array().items(nodeSchema());
                break;

            case 'relationship':
                // TODO: Clean up... This should probably be an object
                validation = relationshipSchema(config.alias || _RelationshipType.DEFAULT_ALIAS, config.properties);

                break;

            case 'relationships':
                validation = _joi2.default.array().items(relationshipSchema(config.alias || _RelationshipType.DEFAULT_ALIAS, config.properties));
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

            case 'point':
                validation = point.point().type(_neo4jDriver.v1.types.Point);
                break;

            case 'int':
            case 'integer':
                validation = _joi2.default.alternatives().try([_joi2.default.number().integer(), _joi2.default.object().type(_neo4jDriver.v1.types.Integer)]);
                break;

            case 'float':
                validation = _joi2.default.number();
                break;

            default:
                validation = _joi2.default.any();
                break;
        }

        if (!config.required) {
            validation = validation.allow(null);
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