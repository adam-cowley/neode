/* eslint indent: 0 */
import { v1 as neo4j } from 'neo4j-driver';

/**
 * Convert a raw property into a JSON friendly format
 *
 * @param  {Property}   property
 * @param  {Mixed}      value
 * @return {Mixed}
 */
export function valueToJson(property, value) {
   if ( neo4j.isInt(value) ) {
       return value.toNumber();
   }
   else if (
        neo4j.temporal.isDate(value)
        || neo4j.temporal.isDateTime(value)
        || neo4j.temporal.isTime(value)
        || neo4j.temporal.isLocalDateTime(value)
        || neo4j.temporal.isLocalTime(value)
        || neo4j.temporal.isDuration(value)
   ) {
       return value.toString();
   }
   else if ( neo4j.spatial.isPoint(value) ) {
       switch (value.srid.toString()) {
           // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
           case '4326': // WGS 84 2D
               return { longitude: value.x, latitude: value.y };

           case '4979': // WGS 84 3D
               return { longitude: value.x, latitude: value.y, height: value.z };

           case '7203': // Cartesian 2D
               return { x: value.x, y: value.y};

           case '9157': // Cartesian 3D
               return { x: value.x, y: value.y, z: value.z };
       }
   }

   return value;
}

/**
 * Convert a property into a cypher value
 *
 * @param {Property} property
 * @param {Mixed}    value
 * @return {Mixed}
 */
export function valueToCypher(property, value) {
    if ( property.convertToInteger() && value !== null && value !== undefined ) {
        value = neo4j.int(value);
    }

    return value;
}

export default class Entity {

    /**
     * Get Internal Node ID
     *
     * @return {int}
     */
    id() {
        return this._identity.toNumber();
    }

    /**
     * Return internal ID as a Neo4j Integer
     *
     * @return {Integer}
     */
    identity() {
        return this._identity;
    }

    /**
     * Return the Node's properties as an Object
     *
     * @return {Object}
     */
    properties() {
        const output = {};

        const model = this._model || this._definition;

        model.properties().forEach((property, key) => {
            if ( !property.hidden() && this._properties.has(key) ) {
                output[ key ] = this.valueToJson(property, this._properties.get( key ));
            }
        });

        return output;
    }

    /**
     * Get a property for this node
     *
     * @param  {String} property Name of property
     * @param  {or}     default  Default value to supply if none exists
     * @return {mixed}
     */
    get(property, or = null) {
        // If property is set, return that
        if ( this._properties.has(property) ) {
            return this._properties.get(property);
        }
        // If property has been set in eager, return that
        else if ( this._eager && this._eager.has(property) ) {
            return this._eager.get(property);
        }

        return or;
    }

    /**
     * Convert a raw property into a JSON friendly format
     *
     * @param  {Property}   property
     * @param  {Mixed}      value
     * @return {Mixed}
     */
    valueToJson(property, value) {
        return valueToJson(property, value);
    }
}