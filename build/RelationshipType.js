'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.DIRECTION_BOTH = exports.DIRECTION_OUT = exports.DIRECTION_IN = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DIRECTION_IN = exports.DIRECTION_IN = 'DIRECTION_IN';
var DIRECTION_OUT = exports.DIRECTION_OUT = 'DIRECTION_OUT';
var DIRECTION_BOTH = exports.DIRECTION_BOTH = 'DIRECTION_BOTH';

var ALT_DIRECTION_IN = 'IN';
var ALT_DIRECTION_OUT = 'OUT';

var RelationshipType = function () {

    /**
     * Constructor
     * @param  {String} type                Reference of Relationship
     * @param  {String} relationship        Internal Neo4j Relationship type (ie 'KNOWS')
     * @param  {String} direction           Direction of Node (Use constants DIRECTION_IN, DIRECTION_OUT, DIRECTION_BOTH)
     * @param  {String|Model|null} target   Target type definition for the
     * @param  {Object} schema              Relationship definition schema
     * @return {Relationship}
     */
    function RelationshipType(type, relationship, direction, target) {
        var schema = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};

        _classCallCheck(this, RelationshipType);

        this._type = type;
        this._relationship = relationship;
        this.setDirection(direction);

        this._target = target;
        this._schema = schema;

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
     * Type
     *
     * @return {String}
     */


    _createClass(RelationshipType, [{
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
            switch (direction.toUpperCase()) {
                case DIRECTION_IN:
                case DIRECTION_OUT:
                    break;

                case ALT_DIRECTION_IN:
                    direction = DIRECTION_IN;
                    break;

                case ALT_DIRECTION_OUT:
                    direction = DIRECTION_OUT;
                    break;

                default:
                    direction = DIRECTION_OUT;
                    break;
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
    }]);

    return RelationshipType;
}();

exports.default = RelationshipType;