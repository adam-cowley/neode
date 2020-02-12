/* eslint-disable no-case-declarations */
import Joi from '@hapi/joi';
import Model from '../Model';
import Node from '../Node';
import RelationshipType, { DEFAULT_ALIAS } from '../RelationshipType';
import ValidationError from '../ValidationError';
import neo4j from 'neo4j-driver';

const joi_options = {
    allowUnknown:true,
    abortEarly:false
};

// TODO: Move these to constants and validate the model schemas a bit better
const ignore = [
    'labels',
    'type',
    'default',
    'alias',
    'properties',
    'primary',
    'relationship',
    'target',
    'direction',
    'eager',
    'hidden',
    'readonly',
    'index',
    'unique',
    'cascade',
];
const booleans = [
    'optional',
    'forbidden',
    'strip',
    'positive',
    'negative',
    'port',
    'integer',
    'iso',
    'isoDate',
    'insensitive',
    'required',
    'truncate',
    'creditCard',
    'alphanum',
    'token',
    'hex',
    'hostname',
    'lowercase',
    'uppercase',
];
const booleanOrOptions = [
    'email',
    'ip',
    'uri',
    'base64',
    'normalize',
    'hex',
];

const temporal = Joi.extend({
    base: Joi.object(),
    name: 'temporal',
    language: {
        before: 'Value before minimum expected value',
        after: 'Value after minimum expected value',
    },
    rules: [
        {
            name: 'after',
            params: {
                after: Joi.alternatives([
                    Joi.date(),
                    Joi.string(),
                ]),
            },
            validate(params, value, state, options) {
                if ( params.after === 'now' ) {
                    params.after = new Date();
                }

                if ( params.after > new Date( value.toString()) ) {
                    return this.createError('temporal.after', { v: value }, state, options);
                }

                return value;
            },
        },
        {
            name: 'before',
            params: {
                after: Joi.alternatives([
                    Joi.date(),
                    Joi.string(),
                ]),
            },
            validate(params, value, state, options) {
                if ( params.after === 'now' ) {
                    params.after = new Date();
                }

                if ( params.after < new Date( value.toString()) ) {
                    return this.createError('temporal.after', { v: value }, state, options);
                }

                return value;
            },
        },
    ],
});

// TODO: Ugly
const neoInteger = Joi.extend({
    // base: Joi.number(),
    base: Joi.alternatives().try([ Joi.number().integer(), Joi.object().type(neo4j.types.Integer) ]),
    name: 'integer',
    language: {
        before: 'Value before minimum expected value',
        after: 'Value after minimum expected value',
    },
    rules: [
        {
            name: 'min',
            params: {
                min: Joi.number(),
            },
            validate(params, value, state, options) {
                const compare = value instanceof neo4j.types.Integer ? value.toNumber() : value;

                if ( params.min > compare ) {
                    return this.createError('number.min', { limit: params.min, }, state, options);
                }

                return value;
            }
        },
        {
            name: 'max',
            params: {
                max: Joi.number(),
            },
            validate(params, value, state, options) {
                const compare = value instanceof neo4j.types.Integer ? value.toNumber() : value;

                if ( params.max < compare ) {
                    return this.createError('number.max', { limit: params.max, }, state, options);
                }

                return value;
            }
        },
        {
            name: 'multiple',
            params: {
                multiple: Joi.number(),
            },
            validate(params, value, state, options) {
                const compare = value instanceof neo4j.types.Integer ? value.toNumber() : value;

                if ( compare % params.multiple != 0 ) {
                    return this.createError('number.multiple', { multiple: params.max, }, state, options);
                }

                return value;
            }
        },
    ]
});

const point = Joi.extend({
    base: Joi.object().type(neo4j.types.Point),
    name: 'point',
});

function nodeSchema() {
    return Joi.alternatives([
        Joi.object().type(Node),
        Joi.string(),
        Joi.number(),
        Joi.object(),
    ]);
}

function relationshipSchema(alias, properties = {}) {
    return Joi.object().keys(Object.assign(
        {},
        {
            [ alias ]: nodeSchema().required(),
        },
        BuildValidationSchema(properties)
    ));
}

function BuildValidationSchema(schema) {
    if ( schema instanceof Model || schema instanceof RelationshipType ) {
        schema = schema.schema();
    }

    let output = {};

    Object.keys(schema).forEach(key => {
        // Ignore Labels
        if ( key == 'labels' ) return;

        const config = typeof schema[ key ] == 'string' ? {type: schema[ key ]} : schema[ key ];

        let validation = false;

        switch (config.type) {

            // TODO: Recursive creation, validate nodes and relationships
            case 'node':
                validation = nodeSchema();
                break;

            case 'nodes':
                validation = Joi.array().items(nodeSchema());
                break;

            case 'relationship':
                // TODO: Clean up... This should probably be an object
                validation = relationshipSchema(config.alias || DEFAULT_ALIAS, config.properties);

                break;

            case 'relationships':
                validation = Joi.array().items(
                    relationshipSchema(config.alias || DEFAULT_ALIAS, config.properties)
                );
                break;

            case 'uuid':
                validation = Joi.string().guid({ version: 'uuidv4' });
                break;

            case 'string':
            case 'number':
            case 'boolean':
                validation = Joi[ config.type ]();
                break;

            case 'datetime':
                validation = temporal.temporal().type(neo4j.types.DateTime);
                break;

            case 'date':
                validation = temporal.temporal().type(neo4j.types.Date);
                break;

            case 'time':
                validation = temporal.temporal().type(neo4j.types.Time);
                break;

            case 'localdate':
                validation = temporal.temporal().type(neo4j.types.LocalDate);
                break;

            case 'localtime':
                validation = temporal.temporal().type(neo4j.types.LocalTime);
                break;

            case 'point':
                validation = point.point().type(neo4j.types.Point);
                break;

            case 'int':
            case 'integer':
                validation = neoInteger.integer();
                break;

            case 'float':
                validation = Joi.number();
                break;

            default:
                validation = Joi.any();
                break;
        }

        if ( ! config.required ) {
            validation = validation.allow(null);
        }

        // Apply additional Validation
        Object.keys(config).forEach(validator => {
            const options = config[validator];

            if ( validator == 'regex' ) {
                if ( options instanceof RegExp ) {
                    validation = validation.regex(options);
                }
                else {
                    const pattern = options.pattern;
                    delete options.pattern;

                    validation = validation.regex(pattern, options);
                }
            }
            else if ( validator == 'replace' ) {
                validation = validation.replace(options.pattern, options.replace);
            }
            else if ( booleanOrOptions.indexOf(validator) > -1 ) {
                if ( typeof options == 'object' ) {
                    validation = validation[ validator ](options);
                }
                else if ( options ) {
                    validation = validation[ validator ]();
                }
            }
            else if ( booleans.indexOf(validator) > -1 ) {
                if ( options === true ) {
                    validation = validation[ validator ](options);
                }
            }
            else if (ignore.indexOf(validator) == -1 && validation[validator]) {
                validation = validation[validator](options);
            }
            else if (ignore.indexOf(validator) == -1 && booleans.indexOf(validator) == -1 ) {
                throw new Error(`Not sure how to validate ${validator} on ${key}`);
            }
        });

        output[ key ] = validation;
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
export default function Validator(neode, model, properties) {
    const schema = BuildValidationSchema(model, properties);

    return new Promise((resolve, reject) => {
        Joi.validate(properties, schema, joi_options, (err, validated) => {
            if (err) {
                return reject( new ValidationError(err.details, properties, err) );
            }

            return resolve(validated);
        });
    });
}