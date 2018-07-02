import Builder from './Query/Builder';
import Create from './Services/Create';
import DeleteAll from './Services/DeleteAll';
import FindAll from './Services/FindAll';
import FindById from './Services/FindById';
import FindWithinDistance from './Services/FindWithinDistance';
import First from './Services/First';
import MergeOn from './Services/MergeOn';
import ToRowMap from './Services/ToRowMap';
import Node from './Node';

export default class Queryable {

    /**
     * @constructor
     *
     * @param Neode neode
     */
    constructor(neode) {
        this._neode = neode;
    }

    /**
     * Return a new Query Builder
     *
     * @return {Builder}
     */
    query() {
        return new Builder(this._neode);
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
     * @param  {Object} match Specific properties to merge on
     * @param  {Object} set   Properties to set
     * @return {Promise}
     */
    mergeOn(match, set) {
        const merge_on = Object.keys(match);
        const properties = Object.assign({}, match, set);

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

    /**
     * Get a collection of nodes for this label
     *
     * @param  {Object}              properties
     * @param  {String|Array|Object} order
     * @param  {Int}                 limit
     * @param  {Int}                 skip
     * @return {Promise}
     */
    all(properties, order, limit, skip) {
        return FindAll(this._neode, this, properties, order, limit, skip);
    }

    /**
     * Find a Node by its Primary Key
     *
     * @param  {mixed} id
     * @return {Promise}
     */
    find(id) {
        const primary_key = this.primaryKey();

        return this.first(primary_key, id);
    }

    /**
     * Find a Node by it's internal node ID
     *
     * @param  {String} model
     * @param  {int}    id
     * @return {Promise}
     */
    findById(id) {
        return FindById(this._neode, this, id);
    }

    /**
     * Find a Node by properties
     *
     * @param  {String} label
     * @param  {mixed}  key     Either a string for the property name or an object of values
     * @param  {mixed}  value   Value
     * @return {Promise}
     */
    first(key, value) {
        return First(this._neode, this, key, value);
    }

    /**
     * Get a collection of nodes within a certain distance belonging to this label
     *
     * @param  {Object}              properties
     * @param  {String}              location_property
     * @param  {Object}              point
     * @param  {Int}                 distance
     * @param  {String|Array|Object} order
     * @param  {Int}                 limit
     * @param  {Int}                 skip
     * @return {Promise}
     */
    withinDistance(location_property, point, distance, properties, order, limit, skip) {
        return FindWithinDistance(this._neode, this, location_property, point, distance, properties, order, limit, skip);
    }

    /**
     * Converts properties into a RowMap which can be used later in UNWIND
     *
     * @param  {object} properties
     * @return {Promise}
     */
    toRowMap(properties) {
        return ToRowMap(this._neode, this, properties);
    }

}