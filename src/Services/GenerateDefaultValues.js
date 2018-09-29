import uuid from 'uuid';
import ValidationError from '../ValidationError';
import CleanValue from './CleanValue';

function GenerateDefaultValuesAsync(neode, model, properties) {
    const schema = model.schema();
    const output = {};

    if ( !(properties instanceof Object )) {
        throw new ValidationError('`properties` must be an object.', properties);
    }

    // Get All Config
    Object.keys(schema).forEach(key => {
        const config = typeof schema[ key ] == 'string' ? {type: schema[ key ]} : schema[ key ];

        switch (config.type) {
            case 'uuid':
                config.default = uuid.v4;
                break;
        }

        if (properties.hasOwnProperty(key)) {
            output[ key ] = properties[ key ];
        }

        // Set Default Value
        else if (typeof config.default !== "undefined") {
            output[ key ] = typeof config.default == 'function' ? config.default() : config.default;
        }

        // Clean Value
        if (output[ key ]) {
            output[ key ] = CleanValue(config, output[ key ]);
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
    const output = GenerateDefaultValuesAsync(neode, model, properties);

    return Promise.resolve(output);
}

GenerateDefaultValues.async = GenerateDefaultValuesAsync;

export default GenerateDefaultValues;
