export default class Collection {

    /**
     * @constructor
     * @param  {Neode} neode    Neode Instance
     * @param  {Node[]} values  Array of Node
     * @return {Collection}
     */
    constructor(neode, values) {
        this._neode = neode;
        this._values = values || [];
    }

    /**
     * Get length property
     *
     * @return {Int}
     */
    get length() {
        return this._values.length;
    }

    /**
     * Iterator
     */
    [Symbol.iterator]() {
        return this._values.values();
    }


    /**
     * Get a value by it's index
     *
     * @param  {Int} index
     * @return {Node}
     */
    get(index) {
        return this._values[index];
    }

    /**
     * Get the first Node in the Collection
     *
     * @return {Node}
     */
    first() {
        return this._values[0];
    }

    /**
     * Add value in collection
     *
     * @param  {mixed} value
     * @return {Collection}
     */
    add(value) {
        this._values.push(value);

        return this;
    }

    /**
     * Map a function to all values
     *
     * @param  {Function} fn
     * @return {mixed}
     */
    map(fn) {
        return this._values.map(fn);
    }

    /**
     * Find value in collection
     *
     * @param  {Function} fn
     * @return {mixed}
     */
    find(fn) {
        return this._values.find(fn);
    }

    /**
     * Run a function on all values
     * @param  {Function} fn
     * @return {mixed}
     */
    forEach(fn) {
        return this._values.forEach(fn);
    }

    /**
     * Map the 'toJson' function on all values
     *
     * @return {Promise}
     */
    toJson() {
        return Promise.all(this._values.map(value => {
            return value.toJson();
        }));
    }

}
