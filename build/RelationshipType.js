'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.DEFAULT_ALIAS = exports.ALT_DIRECTION_OUT = exports.ALT_DIRECTION_IN = exports.DIRECTION_BOTH = exports.DIRECTION_OUT = exports.DIRECTION_IN = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DIRECTION_IN = exports.DIRECTION_IN = 'DIRECTION_IN';
var DIRECTION_OUT = exports.DIRECTION_OUT = 'DIRECTION_OUT';
var DIRECTION_BOTH = exports.DIRECTION_BOTH = 'DIRECTION_BOTH';

var ALT_DIRECTION_IN = exports.ALT_DIRECTION_IN = 'IN';
var ALT_DIRECTION_OUT = exports.ALT_DIRECTION_OUT = 'OUT';

var DEFAULT_ALIAS = exports.DEFAULT_ALIAS = 'node';

var RelationshipType = function () {

    /**
     * Constructor
     * @param  {String} name                The name given to the relationship
     * @param  {String} type                Type of Relationship (relationship, relationships, node, nodes)
     * @param  {String} relationship        Internal Neo4j Relationship type (ie 'KNOWS')
     * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
     * @param  {String|Model|null} target   Target type definition for the Relationship
     * @param  {Object} schema              Relationship definition schema
     * @param  {Bool} eager                 Should this relationship be eager loaded?
     * @param  {Bool|String} cascade        Cascade delete policy for this relationship
     * @param  {String} node_alias          Alias to give to the node in the pattern comprehension
     * @return {Relationship}
     */
    function RelationshipType(name, type, relationship, direction, target) {
        var schema = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : {};
        var eager = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : false;
        var cascade = arguments.length > 7 && arguments[7] !== undefined ? arguments[7] : false;
        var node_alias = arguments.length > 8 && arguments[8] !== undefined ? arguments[8] : DEFAULT_ALIAS;

        _classCallCheck(this, RelationshipType);

        this._name = name;
        this._type = type;
        this._relationship = relationship;
        this.setDirection(direction);

        this._target = target;
        this._schema = schema;

        this._eager = eager;
        this._cascade = cascade;
        this._node_alias = node_alias;

        this._properties = new Map();

        for (var key in schema) {
            var value = schema[key];

            // TODO:
            switch (key) {
                default:
                    this._properties.set(key, new _Property2.default(key, value));
                    break;
            }
        }
    }

    /**
     * Name
     *
     * @return {String}
     */


    _createClass(RelationshipType, [{
        key: 'name',
        value: function name() {
            return this._name;
        }

        /**
         * Type
         *
         * @return {String}
         */

    }, {
        key: 'type',
        value: function type() {
            return this._type;
        }

        /**
         * Get Internal Relationship Type
         *
         * @return {String}
         */

    }, {
        key: 'relationship',
        value: function relationship() {
            return this._relationship;
        }

        /**
         * Set Direction of relationship
         *
         * @return {RelationshipType}
         */

    }, {
        key: 'setDirection',
        value: function setDirection(direction) {
            direction = direction.toUpperCase();

            if (direction == ALT_DIRECTION_IN) {
                direction = DIRECTION_IN;
            } else if (direction == ALT_DIRECTION_OUT) {
                direction = DIRECTION_OUT;
            } else if ([DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH].indexOf(direction) == -1) {
                direction = DIRECTION_OUT;
            }

            this._direction = direction;

            return this;
        }

        /**
         * Get Direction of Node
         *
         * @return {String}
         */

    }, {
        key: 'direction',
        value: function direction() {
            return this._direction;
        }

        /**
         * Get the target node definition
         *
         * @return {Model}
         */

    }, {
        key: 'target',
        value: function target() {
            return this._target;
        }

        /**
         * Get Schema object
         *
         * @return {Object}
         */

    }, {
        key: 'schema',
        value: function schema() {
            return this._schema;
        }

        /**
         * Should this relationship be eagerly loaded?
         *
         * @return {bool}
         */

    }, {
        key: 'eager',
        value: function eager() {
            return this._eager;
        }

        /**
         * Cascade policy for this relationship type
         *
         * @return {String}
         */

    }, {
        key: 'cascade',
        value: function cascade() {
            return this._cascade;
        }

        /**
         * Get Properties defined for this relationship
         *
         * @return Map
         */

    }, {
        key: 'properties',
        value: function properties() {
            return this._properties;
        }

        /**
         * Get the alias given to the node
         *
         * @return {String}
         */

    }, {
        key: 'nodeAlias',
        value: function nodeAlias() {
            return this._node_alias;
        }
    }]);

    return RelationshipType;
}();

exports.default = RelationshipType;