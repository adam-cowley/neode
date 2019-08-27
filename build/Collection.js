"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Collection = function () {

    /**
     * @constructor
     * @param  {Neode} neode    Neode Instance
     * @param  {Node[]} values  Array of Node
     * @return {Collectiob}
     */
    function Collection(neode, values) {
        _classCallCheck(this, Collection);

        this._neode = neode;
        this._values = values || [];
    }

    /**
     * Get length property
     *
     * @return {Int}
     */


    _createClass(Collection, [{
        key: "get",


        /**
         * Get a value by it's index
         *
         * @param  {Int} index
         * @return {Node}
         */
        value: function get(index) {
            return this._values[index];
        }

        /**
         * Get the first Node in the Collection
         *
         * @return {Node}
         */

    }, {
        key: "first",
        value: function first() {
            return this._values[0];
        }

        /**
         * Map a function to all values
         *
         * @param  {Function} fn
         * @return {mixed}
         */

    }, {
        key: "map",
        value: function map(fn) {
            return this._values.map(fn);
        }

        /**
        * Find value in collection
        *
        * @param  {Function} fn
        * @return {mixed}
        */

    }, {
        key: "find",
        value: function find(fn) {
            return this._values.find(fn);
        }

        /**
         * Run a function on all values
         * @param  {Function} fn
         * @return {mixed}
         */

    }, {
        key: "forEach",
        value: function forEach(fn) {
            return this._values.forEach(fn);
        }

        /**
         * Map the 'toJson' function on all values
         *
         * @return {Promise}
         */

    }, {
        key: "toJson",
        value: function toJson() {
            return Promise.all(this._values.map(function (value) {
                return value.toJson();
            }));
        }
    }, {
        key: "length",
        get: function get() {
            return this._values.length;
        }
    }]);

    return Collection;
}();

exports.default = Collection;