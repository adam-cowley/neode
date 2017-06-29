export const DIRECTION_IN = 'DIRECTION_IN';
export const DIRECTION_OUT = 'DIRECTION_OUT';
export const DIRECTION_BOTH = 'DIRECTION_BOTH';

export default class Relationship {

    /**
     * Constructor
     * @param  {String} type                Reference of Relationship
     * @param  {String} relationship        Internal Neo4j Relationship type (ie 'KNOWS')
     * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
     * @param  {String|Model|null} target   Target type definition for the
     * @param  {Object} schema              Relationship definition schema
     * @return {Relationship}
     */
    constructor(type, relationship, direction, target, schema = {}) {
        this._type = type;
        this._relationship = relationship;
        this._direction = direction;
        this._target = target;

        this._properties = new Map;

        for (let key in schema) {
            const value = schema[ key ];

            // TODO:
            switch ( key ) {
                default:
                    this._properties.set(key, new Property(key, value));
                    break;
            }
        }

        this._properties = properties;
    }

    /**
     * Get Internal Relationship Type
     *
     * @return {String}
     */
    relationship() {
        return this._relationship;
    }

    /**
     * Get Direction of Node
     *
     * @return {String}
     */
    direction() {
        return this._direction;
    }

    /**
     * Get the target node definition
     *
     * @return {Model}
     */
    target() {
        return this._target;
    }

}