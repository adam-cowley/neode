
export default class Relationship {

    /**
     * Constructor
     *
     * @param  {Neode}            neode         Neode Instance
     * @param  {RelationshipType} type          Relationship Type definition
     * @param  {Relationship}     relationship  Neo4j Relationship
     * @param  {Node}             from          Start node for the relationship
     * @param  {Node}             to            End node for the relationship
     * @return {Relationship}
     */
    constructor(neode, type, relationship, from, to) {
        this._neode = neode;
        this._type = type;
        this._relationship = relationship;
        this._from = from;
        this._to = to;
        this._type = type;

        this._deleted = false;
    }

    /**
     * Relationship Type definition for this node
     *
     * @return {Model}
     */
    type() {
        return this._type;
    }

    /**
     * Get Internal Relationship ID
     *
     * @return {int}
     */
    id() {
        return this._relationship.identity.toNumber();
    }

    /**
     * Return Internal Relationship ID as Neo4j Integer
     *
     * @return {Integer}
     */
    idInt() {
        return this._relationship.identity;
    }

    /**
     * Get Properties for this Relationship
     *
     * @return {Object}
     */
    properties() {
        return this._relationship.properties;
    }

    /**
     * Get a property for this node
     *
     * @param  {String} property Name of property
     * @param  {or}     default  Default value to supply if none exists
     * @return {mixed}
     */
    get(property, or = null) {
        return this._relationship.properties.hasOwnProperty(property) ? this._relationship.properties[property] : or;
    }

    /**
     * Get originating node for this relationship
     *
     * @return Node
     */
    from() {
        return this._from;
    }

    /**
     * Get destination node for this relationship
     *
     * @return Node
     */
    to() {
        return this._to;
    }


}