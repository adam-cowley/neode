'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Queryable2 = require('./Queryable');

var _Queryable3 = _interopRequireDefault(_Queryable2);

var _RelationshipType = require('./RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Model = function (_Queryable) {
    _inherits(Model, _Queryable);

    function Model(neode, name, schema) {
        _classCallCheck(this, Model);

        var _this = _possibleConstructorReturn(this, (Model.__proto__ || Object.getPrototypeOf(Model)).call(this));

        _this._neode = neode;
        _this._name = name;
        _this._schema = schema;

        _this._properties = new Map();
        _this._relationships = new Map();
        _this._labels = [name];

        // Default Primary Key to {label}_id
        _this._primary_key = name.toLowerCase() + '_id';

        _this._unique = [];
        _this._indexed = [];
        _this._hidden = [];

        // TODO: Clean this up
        for (var key in schema) {
            var value = schema[key];

            switch (key) {
                case 'labels':
                    _this.setLabels.apply(_this, _toConsumableArray(value));
                    break;

                default:
                    if (value.type && value.type == 'relationship') {
                        var relationship = value.relationship,
                            direction = value.direction,
                            target = value.target,
                            properties = value.properties;


                        _this.relationships().set(key, new _RelationshipType2.default(key, relationship, direction, target, properties));
                    } else {
                        _this.addProperty(key, value);
                    }
                    break;
            }
        }
        return _this;
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
         * Get defined merge fields
         *
         * @return {Array}
         */

    }, {
        key: 'mergeFields',
        value: function mergeFields() {
            return this._unique.concat(this._indexed);
        }
    }]);

    return Model;
}(_Queryable3.default);

exports.default = Model;