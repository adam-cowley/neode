import Create from './Services/Create';
import Node from './Node';

export default class Model {
    constructor(neode, name, schema) {
        this._neode = neode;
        this._name = name;
        this._schema = schema;

        this._properties = new Map;
        this._labels = [ name ];

        for (let key in schema) {
            const value = schema[ key ];

            switch ( key ) {
                case 'labels':
                    this._labels = value;
                    break;

                default:
                    this._properties.set(key, value);
                    break;
            }
        }

        if (schema.labels) this.setLabels(schema.labels);
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



}