import { v1 as neo4j } from 'neo4j-driver';

/**
* Convert a value to it's native type
*
* @param  {Object} config   Field Configuration
* @param  {mixed}  value    Value to be converted
* @return {mixed}
*/
export default function CleanValue(config, value) {
   // Clean Values
   switch (config.type.toLowerCase()) {
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

        case 'date':
            value = value instanceof Date ?
            new neo4j.types.Date(
                value.getFullYear(),
                value.getMonth() + 1,
                value.getDate()
            ) : value;
            break;

        case 'datetime':
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

        case 'localdatetime':
            value = value instanceof Date ?
                new neo4j.types.LocalDateTime(
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

        case 'time':
            value = value instanceof Date ?
                new neo4j.types.Time(
                    value.getHours(),
                    value.getMinutes(),
                    value.getSeconds(),
                    value.getMilliseconds() * 1000000,  // nanoseconds
                    value.getTimezoneOffset() * 60      // seconds
               ) : value;
               break;


        case 'localtime':
            value = value instanceof Date ?
                new neo4j.types.LocalTime(
                    value.getHours(),
                    value.getMinutes(),
                    value.getSeconds(),
                    value.getMilliseconds() * 1000000,  // nanoseconds
                ) : value;
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