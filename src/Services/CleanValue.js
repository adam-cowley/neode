/* eslint-disable */
import neo4j from 'neo4j-driver';

const temporal = [
    'date',
    'datetime',
    'time',
    'localdatetime',
    'localtime'
];

/**
* Convert a value to it's native type
*
* @param  {Object} config   Field Configuration
* @param  {mixed}  value    Value to be converted
* @return {mixed}
*/
export default function CleanValue(config, value) {
    // Convert temporal to a native date?
    if ( temporal.indexOf( config.type.toLowerCase() ) > -1 && (typeof value == 'number' || typeof value == 'string') ) {
        value = new Date(value)
    }

    // Clean Values
    switch (config.type.toLowerCase()) {
        case 'float':
            value = parseFloat(value);
            break;

        case 'int':
        case 'integer':
            value = neo4j.int( parseInt(value) );
            break;

        case 'bool':
        case 'boolean':
            value = !! value;
            break;

        case 'timestamp':
            value = value instanceof Date ? value.getTime() : value;
            break;

        case 'date':
            value = value instanceof Date ? neo4j.types.Date.fromStandardDate(value) : value;
            break;

        case 'datetime':
            value = value instanceof Date ? neo4j.types.DateTime.fromStandardDate(value) : value;
            break;

        case 'localdatetime':
            value = value instanceof Date ? neo4j.types.LocalDateTime.fromStandardDate(value) : value;
            break;

        case 'time':
            value = value instanceof Date ? neo4j.types.Time.fromStandardDate(value) : value;
            break;

        case 'localtime':
            value = value instanceof Date ? neo4j.types.LocalTime.fromStandardDate(value) : value;
            break;

        case 'point':
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