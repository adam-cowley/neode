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
     * @return {Node}
     */
    constructor(neode, model, node) {
        this._neode = neode;
        this._model = model;
        this._node = node;

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
        return this._node.identity
    }

    /**
     * Get a property for this node
     *
     * @param  {String} property Name of property
     * @param  {or}     default  Default value to supply if none exists
     * @return {mixed}
     */
    get(property, or = null) {
        return this._node.properties[property] || or;
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
            })
    }

    /**
     * Relate this node to another based on the type
     *
     * @param  {Node}   node        Node to relate to
     * @param  {String} type        Type of Relationship definition
     * @param  {Object} properties  Properties to set against the relationships
     * @return {Promise}
     */
    relateTo(node, type, properties) {
        const relationship = this.model().relationships().get(type);

        if ( !relationship instanceof RelationshipType ) {
            throw new Error(`Cannot find relationship with type ${type}`);
        }


        return RelateTo(this._neode, this, node, relationship, properties);
    }

}