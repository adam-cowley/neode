import Queryable from './Queryable';

import RelationshipType, {DIRECTION_BOTH} from './RelationshipType';
import Property from './Property';

export default class Model extends Queryable {
    constructor(neode, name, schema) {
        super(neode);

        this._name = name;
        this._schema = schema;

        this._properties = new Map;
        this._relationships = new Map;
        this._labels = [ name ];

        // Default Primary Key to {label}_id
        this._primary_key = name.toLowerCase() + '_id';

        this._unique = [];
        this._indexed = [];
        this._hidden = [];
        this._readonly = [];

        // TODO: Clean this up
        for (let key in schema) {
            const value = schema[ key ];

            switch ( key ) {
                case 'labels':
                    this.setLabels(...value);
                    break;

                default:
                    if ( value.type && value.type == 'relationship' ) {
                        const {relationship, direction, target, properties, eager, cascade} = value;

                        this.relationship(key, relationship, direction, target, properties, eager, cascade);
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

        // Should this property be hidden during JSON conversion?
        if ( property.hidden() ) {
            this._hidden.push(key);
        }

        // Is this property only to be read and never written to DB (e.g. auto-generated UUIDs)?
        if ( property.readonly() ) {
            this._readonly.push(key);
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
     * @param  {Object} schema              Property Schema
     * @param  {Bool} eager                 Should this relationship be eager loaded?
     * @param  {Bool|String} cascade        Cascade delete policy for this relationship
     * @return {Relationship}
     */
    relationship(name, relationship, direction = DIRECTION_BOTH, target, schema = {}, eager = false, cascade = false) {
        if (relationship && direction && schema) {
            this._relationships.set(name, new RelationshipType(name, relationship, direction, target, schema, eager, cascade));
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
     * Get relationships defined as Eager relationships
     *
     * @return {Array}
     */
    eager() {
        return Array.from(this._relationships).map(([key, value]) => { // eslint-disable-line  no-unused-vars
            return value._eager ? value : null;
        }).filter(a => !!a);
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
     * Get array of hidden fields
     *
     * @return {String[]}
     */
    hidden() {
        return this._hidden;
    }

    /**
     * Get defined merge fields
     *
     * @return {Array}
     */
    mergeFields() {
        return this._unique.concat(this._indexed);
    }
}