import neo4j from 'neo4j-driver';
import Entity from './Entity';
import UpdateNode from './Services/UpdateNode';
import DeleteNode from './Services/DeleteNode';
import RelateTo from './Services/RelateTo';
import DetachFrom from './Services/DetachFrom';
import RelationshipType from './RelationshipType';

/**
 * Node Container
 */
export default class Node extends Entity {

    /**
     * @constructor
     *
     * @param  {Neode}   neode        Neode Instance
     * @param  {Model}   model        Model definition
     * @param  {Integer} identity     Internal Node ID
     * @param  {Array}   labels       Node labels
     * @param  {Object}  properties   Property Map
     * @param  {Map}     eager        Eagerly loaded values
     * @return {Node}
     */
    constructor(neode, model, identity, labels, properties, eager) {
        super();

        this._neode = neode;
        this._model = model;
        this._identity = identity;
        this._labels = labels;
        this._properties = properties || new Map;

        this._eager = eager || new Map;

        this._deleted = false;
    }

    /**
     * Get the Model for this Node
     *
     * @return {Model}
     */
    model() {
        return this._model;
    }

    /**
     * Get Labels
     *
     * @return {Array}
     */
    labels() {
        return this._labels;
    }

    /**
     * Set an eager value on the fly
     *
     * @param  {String} key
     * @param  {Mixed}  value
     * @return {Node}
     */
    setEager(key, value) {
        this._eager.set(key, value);

        return this;
    }

    /**
     * Delete this node from the Graph
     *
     * @param {Integer} to_depth    Depth to delete to (Defaults to 10)
     * @return {Promise}
     */
    delete(to_depth) {
        return DeleteNode(this._neode, this._identity, this._model, to_depth)
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
    relateTo(node, type, properties = {}, force_create = false) {
        const relationship = this._model.relationships().get(type);

        if ( !(relationship instanceof RelationshipType) ) {
            return Promise.reject( new Error(`Cannot find relationship with type ${type}`) );
        }

        return RelateTo(this._neode, this, node, relationship, properties, force_create)
            .then(rel => {
                this._eager.delete(type);

                return rel;
            });
    }

    /**
     * Detach this node to another
     *
     * @param  {Node} node Node to detach from
     * @return {Promise}
     */
    detachFrom(other) {
        if (!(other instanceof Node)) {
            return Promise.reject(new Error(`Cannot find node with type ${other}`));
        }

        return DetachFrom(this._neode, this, other);
    }

    /**
     * Convert Node to a JSON friendly Object
     *
     * @return {Promise}
     */
    toJson() {
        const output = {
            _id: this.id(),
            _labels: this.labels(),
        };

        // Properties
        this._model.properties().forEach((property, key) => {
            if ( property.hidden() ) {
                return;
            }

            if ( this._properties.has(key) ) {
                output[ key ] = this.valueToJson(property, this._properties.get( key ));
            }
            else if (neo4j.temporal.isDateTime(output[key])) {
                output[key] = new Date(output[key].toString());
            }
            else if (neo4j.spatial.isPoint(output[key])) {
                switch (output[key].srid.toString()) {
                    // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
                    case '4326': // WGS 84 2D
                        output[key] = {longitude: output[key].x, latitude: output[key].y};
                        break;

                    case '4979': // WGS 84 3D
                        output[key] = {longitude: output[key].x, latitude: output[key].y, height: output[key].z};
                        break;

                    case '7203': // Cartesian 2D
                        output[key] = {x: output[key].x, y: output[key].y};
                        break;

                    case '9157': // Cartesian 3D
                        output[key] = {x: output[key].x, y: output[key].y, z: output[key].z};
                        break;
                }
            }
        });

        // Eager Promises
        return Promise.all( this._model.eager().map((rel) => {
            const key = rel.name();

            if ( this._eager.has( rel.name() ) ) {
                // Call internal toJson function on either a Node or NodeCollection
                return this._eager.get( rel.name() ).toJson()
                    .then(value => {
                        return { key, value };
                    });
            }
        }) )
            // Remove Empty
            .then(eager => eager.filter( e => !!e ))

            // Assign to Output
            .then(eager => {
                eager.forEach(({ key, value }) => output[ key ] = value);

                return output;
            });
    }

    /**
     * Update the properties for this node
     *
     * @param {Object} properties  New properties
     * @return {Node}
     */
    update(properties) {

        // TODO: Temporary fix, add the properties to the properties map
        // Sorry, but it's easier than hacking the validator
        this._model.properties().forEach(property => {
            const name = property.name();

            if ( property.required() && !properties.hasOwnProperty(name) ) {
                properties[ name ] = this._properties.get( name );
            }
        });

        return UpdateNode(this._neode, this._model, this._identity, properties)
            .then(properties => {
                properties.map(({ key, value }) => {
                    this._properties.set(key, value)
                })
            })
            .then(() => {
                return this;
            });
    }

}