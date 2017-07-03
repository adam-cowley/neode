'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Create = require('./Services/Create');

var _Create2 = _interopRequireDefault(_Create);

var _MergeOn = require('./Services/MergeOn');

var _MergeOn2 = _interopRequireDefault(_MergeOn);

var _DeleteAll = require('./Services/DeleteAll');

var _DeleteAll2 = _interopRequireDefault(_DeleteAll);

var _Node = require('./Node');

var _Node2 = _interopRequireDefault(_Node);

var _RelationshipType = require('./RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Model = function () {
    function Model(neode, name, schema) {
        _classCallCheck(this, Model);

        this._neode = neode;
        this._name = name;
        this._schema = schema;

        this._properties = new Map();
        this._relationships = new Map();
        this._labels = [name];

        // Default Primary Key to {label}_id
        this._primary_key = name.toLowerCase() + '_id';

        this._unique = [];
        this._indexed = [];
        this._hidden = [];

        // TODO: Clean this up
        for (var key in schema) {
            var value = schema[key];

            switch (key) {
                case 'labels':
                    this.setLabels(value);
                    break;

                default:
                    if (value.type && value.type == 'relationship') {
                        var relationship = value.relationship,
                            direction = value.direction,
                            target = value.target,
                            properties = value.properties;


                        this.relationships().set(key, new _RelationshipType2.default(key, relationship, direction, target, properties));
                    } else {
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


    _createClass(Model, [{
        key: 'name',
        value: function name() {
            return this._name;
        }

        /**
         * Get Schema
         *
         * @return {Object}
         */

    }, {
        key: 'schema',
        value: function schema() {
            return this._schema;
        }

        /**
         * Get a map of Properties
         *
         * @return {Map}
         */

    }, {
        key: 'properties',
        value: function properties() {
            return this._properties;
        }

        /**
         * Set Labels
         *
         * @param  {...String} labels
         * @return {Model}
         */

    }, {
        key: 'setLabels',
        value: function setLabels() {
            for (var _len = arguments.length, labels = Array(_len), _key = 0; _key < _len; _key++) {
                labels[_key] = arguments[_key];
            }

            this._labels = labels;

            return this;
        }

        /**
         * Get Labels
         *
         * @return {Array}
         */

    }, {
        key: 'labels',
        value: function labels() {
            return this._labels;
        }

        /**
         * Add a property definition
         *
         * @param {String} key    Property name
         * @param {Object} schema Schema object
         * @return {Model}
         */

    }, {
        key: 'addProperty',
        value: function addProperty(key, schema) {
            var property = new _Property2.default(key, schema);

            this._properties.set(key, property);

            // Is this key the primary key?
            if (property.primary()) {
                this._primary_key = key;
            }

            // Is this property unique?
            if (property.unique() || property.primary()) {
                this._unique.push(key);
            }

            // Is this property indexed?
            if (property.indexed()) {
                this._indexed.push(key);
            }

            // Should this property be hidden during JSON conversion?
            if (property.hidden()) {
                this._hidden.push(key);
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

    }, {
        key: 'relationship',
        value: function relationship(name, _relationship) {
            var direction = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : _RelationshipType.DIRECTION_BOTH;
            var target = arguments[3];
            var validation = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};

            if (_relationship && direction && validation) {
                this._relationships.set(name, new _RelationshipType2.default(name, _relationship, direction, target, validation));
            }

            return this._relationships.get(name);
        }

        /**
         * Get all defined Relationships  for this Model
         *
         * @return {Map}
         */

    }, {
        key: 'relationships',
        value: function relationships() {
            return this._relationships;
        }

        /**
         * Get the name of the primary key
         *
         * @return {String}
         */

    }, {
        key: 'primaryKey',
        value: function primaryKey() {
            return this._primary_key;
        }

        /**
         * Get array of hidden fields
         *
         * @return {String[]}
         */

    }, {
        key: 'hidden',
        value: function hidden() {
            return this._hidden;
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
            var _this = this;

            return (0, _Create2.default)(this._neode, this, properties).then(function (node) {
                return new _Node2.default(_this._neode, _this, node);
            });
        }

        /**
         * Get defined merge fields
         *
         * @return {Array}
         */

    }, {
        key: 'mergeFields',
        value: function mergeFields() {
            return this._unique.concat(this._indexed);
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
            var _this2 = this;

            var merge_on = this.mergeFields();

            return (0, _MergeOn2.default)(this._neode, this, merge_on, properties).then(function (node) {
                return new _Node2.default(_this2._neode, _this2, node);
            });
        }

        /**
         * Merge a node based on the supplied properties
         *
         * @param  {Object} merge Specific properties to merge on
         * @param  {Object} set   Properties to set
         * @return {Promise}
         */

    }, {
        key: 'mergeOn',
        value: function mergeOn(merge, set) {
            var _this3 = this;

            var merge_on = Object.keys(merge);
            var properties = Object.assign({}, merge, set);

            return (0, _MergeOn2.default)(this._neode, this, merge_on, properties).then(function (node) {
                return new _Node2.default(_this3._neode, _this3, node);
            });
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
    }]);

    return Model;
}();

exports.default = Model;