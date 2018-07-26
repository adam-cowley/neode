import Entity from './Entity';
import { DIRECTION_IN, DIRECTION_OUT, } from './RelationshipType';

export default class Relationship extends Entity {
    /**
     * 
     * @param {Neode}            neode          Neode instance
     * @param {RelationshipType} definition     Relationship type definition
     * @param {Integer}          identity       Identity
     * @param {String}           relationship   Relationship type
     * @param {Map}              properties     Map of properties for the relationship
     * @param {Node}             start          Start Node
     * @param {Node}             end            End Node
     * @param {String}           node_alias     Alias given to the Node when converting to JSON
     */
    constructor(neode, definition, identity, type, properties, start, end, node_alias) {
        super();

        this._neode = neode;
        this._definition = definition;
        this._identity = identity;
        this._type = type;
        this._properties = properties || new Map;
        this._start = start;
        this._end = end;
        this._node_alias = node_alias;
    }

    /** 
     * Get the definition for this relationship
     * 
     * @return {Definition}
     */
    definition() {
        return this._definition
    }

    /** 
     * Get the relationship type
     */
    type() {
        return this._type;
    }

    /**
     * Get the start node for this relationship
     * 
     * @return {Node}
     */
    startNode() {
        return this._start;
    }

    /**
     * Get the start node for this relationship
     * 
     * @return {Node}
     */
    endNode() {
        return this._end;
    }

    /** 
     * Get the node on the opposite end of the Relationship to the subject
     * (ie if direction is in, get the end node, otherwise get the start node)
     */
    otherNode() {
        return this._definition.direction() == DIRECTION_IN 
            ? this.startNode()
            : this.endNode();
    }

    /**
     * Convert Relationship to a JSON friendly Object
     *
     * @return {Promise}
     */
    toJson() {
        const output = {
            _id: this.id(),
            _type: this.type(),
        };

        const definition = this.definition();

        // Properties
        definition.properties().forEach((property, key) => {
            if ( property.hidden() ) {
                return;
            }

            if ( this._properties.has(key) ) {
                output[ key ] = this.valueToJson(property, this._properties.get( key ));
            }
        });

        // Get Other Node
        return this.otherNode().toJson()
            .then(json => {
                output[ definition.nodeAlias() ] = json;

                return output;
            });
    }
}
