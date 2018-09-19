'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Builder = require('./Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _Create = require('./Services/Create');

var _Create2 = _interopRequireDefault(_Create);

var _DeleteAll = require('./Services/DeleteAll');

var _DeleteAll2 = _interopRequireDefault(_DeleteAll);

var _FindAll = require('./Services/FindAll');

var _FindAll2 = _interopRequireDefault(_FindAll);

var _FindById = require('./Services/FindById');

var _FindById2 = _interopRequireDefault(_FindById);

var _FindWithinDistance = require('./Services/FindWithinDistance');

var _FindWithinDistance2 = _interopRequireDefault(_FindWithinDistance);

var _First = require('./Services/First');

var _First2 = _interopRequireDefault(_First);

var _MergeOn = require('./Services/MergeOn');

var _MergeOn2 = _interopRequireDefault(_MergeOn);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Queryable = function () {

    /**
     * @constructor
     *
     * @param Neode neode
     */
    function Queryable(neode) {
        _classCallCheck(this, Queryable);

        this._neode = neode;
    }

    /**
     * Return a new Query Builder
     *
     * @return {Builder}
     */


    _createClass(Queryable, [{
        key: 'query',
        value: function query() {
            return new _Builder2.default(this._neode);
        }

        /**
         * Create a new instance of this Model
         *
         * @param  {object} properties
         * @return {Promise}
         */

    }, {
        key: 'create',
        value: function create(properties) {
            return (0, _Create2.default)(this._neode, this, properties);
        }

        /**
         * Merge a node based on the defined indexes
         *
         * @param  {Object} properties
         * @return {Promise}
         */

    }, {
        key: 'merge',
        value: function merge(properties) {
            var merge_on = this.mergeFields();

            return (0, _MergeOn2.default)(this._neode, this, merge_on, properties);
        }

        /**
         * Merge a node based on the supplied properties
         *
         * @param  {Object} match Specific properties to merge on
         * @param  {Object} set   Properties to set
         * @return {Promise}
         */

    }, {
        key: 'mergeOn',
        value: function mergeOn(match, set) {
            var merge_on = Object.keys(match);
            var properties = Object.assign({}, match, set);

            return (0, _MergeOn2.default)(this._neode, this, merge_on, properties);
        }

        /**
         * Delete all nodes for this model
         *
         * @return {Promise}
         */

    }, {
        key: 'deleteAll',
        value: function deleteAll() {
            return (0, _DeleteAll2.default)(this._neode, this);
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

    }, {
        key: 'all',
        value: function all(properties, order, limit, skip) {
            return (0, _FindAll2.default)(this._neode, this, properties, order, limit, skip);
        }

        /**
         * Find a Node by its Primary Key
         *
         * @param  {mixed} id
         * @return {Promise}
         */

    }, {
        key: 'find',
        value: function find(id) {
            var primary_key = this.primaryKey();

            return this.first(primary_key, id);
        }

        /**
         * Find a Node by it's internal node ID
         *
         * @param  {String} model
         * @param  {int}    id
         * @return {Promise}
         */

    }, {
        key: 'findById',
        value: function findById(id) {
            return (0, _FindById2.default)(this._neode, this, id);
        }

        /**
         * Find a Node by properties
         *
         * @param  {String} label
         * @param  {mixed}  key     Either a string for the property name or an object of values
         * @param  {mixed}  value   Value
         * @return {Promise}
         */

    }, {
        key: 'first',
        value: function first(key, value) {
            return (0, _First2.default)(this._neode, this, key, value);
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

    }, {
        key: 'withinDistance',
        value: function withinDistance(location_property, point, distance, properties, order, limit, skip) {
            return (0, _FindWithinDistance2.default)(this._neode, this, location_property, point, distance, properties, order, limit, skip);
        }
    }]);

    return Queryable;
}();

exports.default = Queryable;