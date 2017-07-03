'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Update = require('./Services/Update');

var _Update2 = _interopRequireDefault(_Update);

var _Delete = require('./Services/Delete');

var _Delete2 = _interopRequireDefault(_Delete);

var _RelateTo = require('./Services/RelateTo');

var _RelateTo2 = _interopRequireDefault(_RelateTo);

var _RelationshipType = require('./RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Node = function () {

    /**
     * @constructor
     *
     * @param  {Neode} neode  Neode Instance
     * @param  {Model} model  Model definition
     * @param  {node}  node   Node Onject from neo4j-driver
     * @return {Node}
     */
    function Node(neode, model, node) {
        _classCallCheck(this, Node);

        this._neode = neode;
        this._model = model;
        this._node = node;

        this._deleted = false;
    }

    /**
     * Model definition for this node
     *
     * @return {Model}
     */


    _createClass(Node, [{
        key: 'model',
        value: function model() {
            return this._model;
        }

        /**
         * Get Internal Node ID
         *
         * @return {int}
         */

    }, {
        key: 'id',
        value: function id() {
            return this._node.identity.toNumber();
        }

        /**
         * Return Internal Node ID as Neo4j Integer
         *
         * @return {Integer}
         */

    }, {
        key: 'idInt',
        value: function idInt() {
            return this._node.identity;
        }

        /**
         * Get a property for this node
         *
         * @param  {String} property Name of property
         * @param  {or}     default  Default value to supply if none exists
         * @return {mixed}
         */

    }, {
        key: 'get',
        value: function get(property) {
            var or = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

            return this._node.properties[property] || or;
        }

        /**
         * Get all properties for this node
         *
         * @return {Object}
         */

    }, {
        key: 'properties',
        value: function properties() {
            return this._node.properties;
        }

        /**
         * Update the properties of a node
         * @param  {Object} properties Updated properties
         * @return {Promise}
         */

    }, {
        key: 'update',
        value: function update(properties) {
            var _this = this;

            return (0, _Update2.default)(this._neode, this, this._node, properties).then(function (node) {
                _this._node = node;

                return _this;
            });
        }

        /**
         * Delete this node from the Graph
         *
         * @return {Promise}
         */

    }, {
        key: 'delete',
        value: function _delete() {
            var _this2 = this;

            return (0, _Delete2.default)(this._neode, this._node).then(function () {
                _this2._deleted = true;

                return _this2;
            });
        }

        /**
         * Relate this node to another based on the type
         *
         * @param  {Node}   node        Node to relate to
         * @param  {String} type        Type of Relationship definition
         * @param  {Object} properties  Properties to set against the relationships
         * @return {Promise}
         */

    }, {
        key: 'relateTo',
        value: function relateTo(node, type, properties) {
            var relationship = this.model().relationships().get(type);

            if (!relationship instanceof _RelationshipType2.default) {
                throw new Error('Cannot find relationship with type ' + type);
            }

            return (0, _RelateTo2.default)(this._neode, this, node, relationship, properties);
        }

        /**
         * When converting to string, return this model's primary key
         *
         * @return {String}
         */

    }, {
        key: 'toString',
        value: function toString() {
            return this.get(this.model().primaryKey());
        }

        /**
         * Convert Node to Object
         *
         * @return {Promise}
         */

    }, {
        key: 'toJson',
        value: function toJson() {
            var output = Object.assign({}, { '_id': this.id() }, this._node.properties);

            this.model().hidden().forEach(function (key) {
                delete output[key];
            });

            return Promise.resolve(output);
        }
    }]);

    return Node;
}();

exports.default = Node;