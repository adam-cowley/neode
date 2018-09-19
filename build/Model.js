'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

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

var RELATIONSHIP_TYPES = ['relationship', 'relationships', 'node', 'nodes'];

var Model = function (_Queryable) {
    _inherits(Model, _Queryable);

    function Model(neode, name, schema) {
        _classCallCheck(this, Model);

        var _this = _possibleConstructorReturn(this, (Model.__proto__ || Object.getPrototypeOf(Model)).call(this, neode));

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
        _this._readonly = [];

        // TODO: Clean this up
        for (var key in schema) {
            var value = schema[key];

            switch (key) {
                case 'labels':
                    _this.setLabels.apply(_this, _toConsumableArray(value));
                    break;

                default:
                    if (value.type && RELATIONSHIP_TYPES.indexOf(value.type) > -1) {
                        var relationship = value.relationship,
                            direction = value.direction,
                            target = value.target,
                            properties = value.properties,
                            eager = value.eager,
                            cascade = value.cascade,
                            alias = value.alias;


                        _this.relationship(key, value.type, relationship, direction, target, properties, eager, cascade, alias);
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

            this._labels = labels.sort();

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

            // Is this property only to be read and never written to DB (e.g. auto-generated UUIDs)?
            if (property.readonly()) {
                this._readonly.push(key);
            }

            return this;
        }

        /**
         * Add a new relationship
         *
         * @param  {String} name                The name given to the relationship
         * @param  {String} type                Type of Relationship
         * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
         * @param  {String|Model|null} target   Target type definition for the
         * @param  {Object} schema              Property Schema
         * @param  {Bool} eager                 Should this relationship be eager loaded?
         * @param  {Bool|String} cascade        Cascade delete policy for this relationship
         * @param  {String} node_alias          Alias to give to the node in the pattern comprehension
         * @return {Relationship}
         */

    }, {
        key: 'relationship',
        value: function relationship(name, type, _relationship) {
            var direction = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : _RelationshipType.DIRECTION_BOTH;
            var target = arguments[4];
            var schema = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : {};
            var eager = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : false;
            var cascade = arguments.length > 7 && arguments[7] !== undefined ? arguments[7] : false;
            var node_alias = arguments.length > 8 && arguments[8] !== undefined ? arguments[8] : 'node';

            if (_relationship && direction && schema) {
                this._relationships.set(name, new _RelationshipType2.default(name, type, _relationship, direction, target, schema, eager, cascade, node_alias));
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
         * Get relationships defined as Eager relationships
         *
         * @return {Array}
         */

    }, {
        key: 'eager',
        value: function eager() {
            return Array.from(this._relationships).map(function (_ref) {
                var _ref2 = _slicedToArray(_ref, 2),
                    key = _ref2[0],
                    value = _ref2[1];

                // eslint-disable-line  no-unused-vars
                return value._eager ? value : null;
            }).filter(function (a) {
                return !!a;
            });
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
         * Get array of indexed fields
         *
         * @return {String[]}
         */

    }, {
        key: 'indexes',
        value: function indexes() {
            return this._indexed;
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