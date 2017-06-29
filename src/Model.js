import Create from './Services/Create';
import DeleteAll from './Services/DeleteAll';
import Node from './Node';
import Relationship, {DIRECTION_BOTH} from './Relationship';
import Property from './Property';

export default class Model {
    constructor(neode, name, schema) {
        this._neode = neode;
        this._name = name;
        this._schema = schema;

        this._properties = new Map;
        this._relationships = new Map;
        this._labels = [ name ];

        // TODO: Clean this up
        for (let key in schema) {
            const value = schema[ key ];

            switch ( key ) {
                case 'labels':
                    this.setLabels(value);
                    break;

                default:
                    this._properties.set(key, new Property(key, value));
                    break;
            }
        }
    }

    /**
     * Get Model name
     *
     * @return {String}
     */
    name() {
        return this._name;
    }

    /**
     * Get Schema
     *
     * @return {Object}
     */
    schema() {
        return this._schema;
    }

    /**
     * Get a map of Properties
     *
     * @return {Map}
     */
    properties() {
        return this._properties;
    }

    /**
     * Set Labels
     *
     * @param  {...[String]} labels
     * @return {Model}
     */
    setLabels(...labels) {
        this._labels = labels;

        return this;
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
     * Create a new instance of this Model
     *
     * @param  {object} properties
     * @return {Node}
     */
    create(properties) {
        return Create(this._neode, this, properties)
            .then(node => {
                return new Node(this._neode, this, node);
            });
    }

    /**
     * Delete all nodes for this model
     *
     * @return {Promise}
     */
    deleteAll() {
        return DeleteAll(this._neode, this);
    }

    /**
     * Add a new relationship
     *
     * @param  {String} name                Reference of Relationship
     * @param  {String} relationship        Internal Relationship type
     * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
     * @param  {String|Model|null} target   Target type definition for the
     * @param  {Object} validation          Property Validation options
     * @return {Relationship}
     */
    relationship(name, relationship, direction = DIRECTION_BOTH, validation = {}) {
        if (relationship && direction && validation) {
            this._relationships.set(name, new Relationship(name, relationship, direction, validation));
        }

        return this._relationships.get(name);
    }



}