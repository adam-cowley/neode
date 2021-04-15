import Property from './Property';

export const DIRECTION_IN = 'DIRECTION_IN';
export const DIRECTION_OUT = 'DIRECTION_OUT';
export const DIRECTION_BOTH = 'DIRECTION_BOTH';

export const ALT_DIRECTION_IN = 'IN';
export const ALT_DIRECTION_OUT = 'OUT';

export const DEFAULT_ALIAS = 'node';

export default class RelationshipType {

    /**
     * Constructor
     * @param  {String} name                The name given to the relationship
     * @param  {String} type                Type of Relationship (relationship, relationships, node, nodes)
     * @param  {String} relationship        Internal Neo4j Relationship type (ie 'KNOWS')
     * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
     * @param  {String|Model|null} target   Target type definition for the Relationship
     * @param  {Object} schema              Relationship definition schema
     * @param  {Bool} eager                 Should this relationship be eager loaded?
     * @param  {Bool|String} cascade        Cascade delete policy for this relationship
     * @param  {String} node_alias          Alias to give to the node in the pattern comprehension
     * @return {Relationship}
     */
    constructor(name, type, relationship, direction, target, schema = {}, eager = false, cascade = false, node_alias = DEFAULT_ALIAS) {
        this._name = name;
        this._type = type;
        this._relationship = relationship;
        this.setDirection(direction);

        this._target = target;
        this._schema = schema;

        this._eager = eager;
        this._cascade = cascade;
        this._node_alias = node_alias;

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
    }

    /**
     * Name
     *
     * @return {String}
     */
    name() {
        return this._name;
    }

    /**
     * Type
     *
     * @return {String}
     */
    type() {
        return this._type;
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
     * Set Direction of relationship
     *
     * @return {RelationshipType}
     */
    setDirection(direction) {
        direction = direction.toUpperCase();

        if ( direction == ALT_DIRECTION_IN ) {
            direction = DIRECTION_IN;
        }
        else if ( direction == ALT_DIRECTION_OUT ) {
            direction = DIRECTION_OUT;
        }
        else if ( [ DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH ].indexOf(direction) == -1 ) {
            direction = DIRECTION_OUT;
        }

        this._direction = direction;

        return this;
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

    /**
     * Get Schema object
     *
     * @return {Object}
     */
    schema() {
        return this._schema;
    }

    /**
     * Should this relationship be eagerly loaded?
     *
     * @return {bool}
     */
    eager() {
        return this._eager;
    }

    /**
     * Cascade policy for this relationship type
     *
     * @return {String}
     */
    cascade() {
        return this._cascade;
    }

    /**
     * Get Properties defined for this relationship
     *
     * @return Map
     */
    properties() {
        return this._properties;
    }

    /**
     * Get the alias given to the node
     *
     * @return {String}
     */
    nodeAlias() {
        return this._node_alias;
    }

}