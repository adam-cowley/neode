import uuid from 'uuid';
import {v1 as neo4j} from 'neo4j-driver';
import ValidationError from '../ValidationError';

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
            value = !! value;
            break;

        case 'timestamp':
            value = value instanceof Date ? value.getTime() : value;
            break;

        case 'DateTime':
            value = value instanceof Date ?
                new neo4j.types.DateTime(
                    value.getFullYear(),
                    value.getMonth() + 1,
                    value.getDate(),
                    value.getHours(),
                    value.getMinutes(),
                    value.getSeconds(),
                    value.getMilliseconds() * 1000000,  // nanoseconds
                    value.getTimezoneOffset() * 60      // seconds
                ) : value;
            break;

        case 'Point':
            // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
            if (isNaN(value.x)) { // WGS 84
                if (isNaN(value.height)) {
                    value = new neo4j.types.Point(
                        4326, // WGS 84 2D
                        value.longitude,
                        value.latitude
                    );
                }
                else {
                    value = new neo4j.types.Point(
                        4979, // WGS 84 3D
                        value.longitude,
                        value.latitude,
                        value.height
                    );
                }
            }
            else {
                if (isNaN(value.z)) {
                    value = new neo4j.types.Point(
                        7203, // Cartesian 2D
                        value.x,
                        value.y
                    );
                }
                else {
                    value = new neo4j.types.Point(
                        9157, // Cartesian 3D
                        value.x,
                        value.y,
                        value.z
                    );
                }
            }
            break;
    }

    return value;
}

/**
 * Generate default values where values are not currently set.
 *
 * @param  {Neode}  neode
 * @param  {Model}  model
 * @param  {Object} properties
 * @return {Promise}
 */
export default function ToRowMap(neode, model, properties) {
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
        else if (config.default) {
            output[ key ] = typeof config.default == 'function' ? config.default() : config.default;
        }

        // Clean Value
        if (output[ key ]) {
            output[ key ] = CleanValue(config, output[ key ]);
        }
    });

    return Promise.resolve(output);
}