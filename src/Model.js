import Create from './Services/Create';
import MergeOn from './Services/MergeOn';
import DeleteAll from './Services/DeleteAll';
import Node from './Node';
import RelationshipType, {DIRECTION_BOTH} from './RelationshipType';
import Property from './Property';

export default class Model {
    constructor(neode, name, schema) {
        this._neode = neode;
        this._name = name;
        this._schema = schema;

        this._properties = new Map;
        this._relationships = new Map;
        this._labels = [ name ];

        // Default Primary Key to {label}_id
        this._primary_key = name.toLowerCase() + '_id';

        this._unique = [];
        this._indexed = [];

        // TODO: Clean this up
        for (let key in schema) {
            const value = schema[ key ];

            switch ( key ) {
                case 'labels':
                    this.setLabels(value);
                    break;

                default:
                    if ( value.type && value.type == 'relationship' ) {
                        const {relationship, direction, target, properties} = value;

                        this.relationships().set(key, new RelationshipType(key, relationship, direction, target, properties));
                    }
                    else {
                        this.addProperty(key, value);
                    }
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
     * @param  {...String} labels
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
     * Add a property definition
     *
     * @param {String} key    Property name
     * @param {Object} schema Schema object
     * @return {Model}
     */
    addProperty(key, schema) {
        const property = new Property(key, schema);

        this._properties.set(key, property);

        // Is this key the primary key?
        if ( property.primary() ) {
            this._primary_key = key;
        }

        // Is this property unique?
        if ( property.unique() || property.primary() ) {
            this._unique.push(key);
        }

        // Is this property indexed?
        if ( property.indexed() ) {
            this._indexed.push(key);
        }

        return this;
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
    relationship(name, relationship, direction = DIRECTION_BOTH, target, validation = {}) {
        if (relationship && direction && validation) {
            this._relationships.set(name, new RelationshipType(name, relationship, direction, target, validation));
        }

        return this._relationships.get(name);
    }

    /**
     * Get all defined Relationships  for this Model
     *
     * @return {Map}
     */
    relationships() {
        return this._relationships;
    }

    /**
     * Get the name of the primary key
     *
     * @return {String}
     */
    primaryKey() {
        return this._primary_key;
    }

    /**
     * Create a new instance of this Model
     *
     * @param  {object} properties
     * @return {Promise}
     */
    create(properties) {
        return Create(this._neode, this, properties)
            .then(node => {
                return new Node(this._neode, this, node);
            });
    }

    /**
     * Get defined merge fields
     *
     * @return {Array}
     */
    mergeFields() {
        return this._unique.concat(this._indexed);
    }

    /**
     * Merge a node based on the defined indexes
     *
     * @param  {Object} properties
     * @return {Promise}
     */
    merge(properties) {
        const merge_on = this.mergeFields();

        return MergeOn(this._neode, this, merge_on, properties)
            .then(node => {
                return new Node(this._neode, this, node);
            });
    }

    /**
     * Merge a node based on the supplied properties
     *
     * @param  {Object} merge Specific properties to merge on
     * @param  {Object} set   Properties to set
     * @return {Promise}
     */
    mergeOn(merge, set) {
        const merge_on = Object.keys(merge);
        const properties = Object.assign({}, merge, set);

        return MergeOn(this._neode, this, merge_on, properties)
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




}