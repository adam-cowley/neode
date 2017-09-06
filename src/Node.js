import Update from './Services/Update';
import Delete from './Services/Delete';
import RelateTo from './Services/RelateTo';
import RelationshipType from './RelationshipType';

export default class Node {

    /**
     * @constructor
     *
     * @param  {Neode} neode  Neode Instance
     * @param  {Model} model  Model definition
     * @param  {node}  node   Node Onject from neo4j-driver
     * @param  {Map)   eager  Eagerly loaded values
     * @return {Node}
     */
    constructor(neode, model, node, eager) {
        this._neode = neode;
        this._model = model;
        this._node = node;

        this._eager = eager || new Map;

        this._deleted = false;
    }

    /**
     * Model definition for this node
     *
     * @return {Model}
     */
    model() {
        return this._model;
    }

    /**
     * Get Internal Node ID
     *
     * @return {int}
     */
    id() {
        return this._node.identity.toNumber();
    }

    /**
     * Return Internal Node ID as Neo4j Integer
     *
     * @return {Integer}
     */
    idInt() {
        return this._node.identity;
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
        if ( this._node.properties.hasOwnProperty(property) ) {
            return this._node.properties[property];
        }
        // If property has been set in eager, return that
        else if ( this._eager.has(property) ) {
            return this._eager.get(property);
        }

        return or;
    }

    /**
     * Get all properties for this node
     *
     * @return {Object}
     */
    properties() {
        return this._node.properties;
    }

    /**
     * Update the properties of a node
     * @param  {Object} properties Updated properties
     * @return {Promise}
     */
    update(properties) {
        return Update(this._neode, this, this._node, properties)
            .then(node => {
                this._node = node;

                return this;
            });
    }

    /**
     * Delete this node from the Graph
     *
     * @return {Promise}
     */
    delete() {
        return Delete(this._neode, this._node)
            .then(() => {
                this._deleted = true;

                return this;
            });
    }

    /**
     * Relate this node to another based on the type
     *
     * @param  {Node}   node            Node to relate to
     * @param  {String} type            Type of Relationship definition
     * @param  {Object} properties      Properties to set against the relationships
     * @param  {Boolean} force_create   Force the creation a new relationship? If false, the relationship will be merged
     * @return {Promise}
     */
    relateTo(node, type, properties, force_create = false) {
        const relationship = this.model().relationships().get(type);

        if ( !(relationship instanceof RelationshipType) ) {
            throw new Error(`Cannot find relationship with type ${type}`);
        }


        return RelateTo(this._neode, this, node, relationship, properties, force_create);
    }

    /**
     * When converting to string, return this model's primary key
     *
     * @return {String}
     */
    toString() {
        return this.get( this.model().primaryKey() );
    }

    /**
     * Convert Node to Object
     *
     * @return {Promise}
     */
    toJson() {
        const output = Object.assign({}, {'_id': this.id()}, this._node.properties);

        this.model().hidden().forEach(key => {
            delete output[ key ];
        });

        return Promise.resolve(output);
    }

}