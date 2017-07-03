import Joi from 'joi';
import Model from '../Model';
import ValidationError from '../ValidationError';

const joi_options = {
    allowUnknown:true,
    abortEarly:false
};

function BuildValidationSchema(model) {
    const schema = model.schema();
    let output = {};

    Object.keys(schema).forEach(key => {
        const config = typeof schema[ key ] == 'string' ? {type: schema[ key ]} : schema[ key ];

        // Remove Default
        // delete config.type;
        // delete config.default;

        let validation = false;

        switch (config.type) {
            case 'node':
                validation = Joi.object().type(Model);
                break;

            case 'uuid':
                validation = Joi.string();
                break;

            //  TODO: Support more types
            case 'string':
            case 'number':
            case 'boolean':
                validation = Joi[ config.type ]();
                break;

            default:
                validation = Joi.any();
                break;
        }

        // Apply additional Validation
        const ignore = ['type', 'default'];
        Object.keys(config).forEach(validator => {
            if (ignore.indexOf(validator) == -1 && validation[validator]) {
                validation = validation[validator](config[validator]);
            }
        });

        output[ key ] = validation;
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