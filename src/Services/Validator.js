import Joi from 'joi';
import Node from '../Node';
import ValidationError from '../ValidationError';

const joi_options = {
    allowUnknown:true,
    abortEarly:false
};

const ignore = ['type', 'default'];
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
    'hex'
];

function BuildValidationSchema(model) {
    const schema = model.schema();
    let output = {};

    Object.keys(schema).forEach(key => {
        const config = typeof schema[ key ] == 'string' ? {type: schema[ key ]} : schema[ key ];

        let validation = false;

        switch (config.type) {
            // TODO: Recursive creation, validate nodes and relationships
            case 'node':
                validation = Joi.alternatives([
                    Joi.object().type(Node),
                    Joi.string(),
                    Joi.number(),
                    Joi.object(),
                ]);
                break;

            case 'uuid':
                validation = Joi.string().guid({ version: 'uuidv4' });
                break;

            case 'string':
            case 'number':
            case 'boolean':
                validation = Joi[ config.type ]();
                break;

            case 'date':
            case 'datetime':
            case 'time':
            case 'localdate':
            case 'localtime':
                validation = Joi.date();
                break;

            case 'int':
            case 'integer':
                validation = Joi.number().integer();
                break;

            case 'float':
                validation = Joi.number();
                break;

            default:
                validation = Joi.any();
                break;
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
                let errors = {};

                err.details.forEach(e => {
                    if ( !errors[ e.path ] ) {
                        errors[ e.path ] = [];
                    }

                    errors[ e.path ].push(e.type);
                });

                return reject( new ValidationError(errors) );
            }

            resolve(validated);
        });
    });
}