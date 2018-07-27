'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _neo4jDriver = require('neo4j-driver');

var _Entity2 = require('./Entity');

var _Entity3 = _interopRequireDefault(_Entity2);

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

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/** 
 * Node Container
 */
var Node = function (_Entity) {
    _inherits(Node, _Entity);

    /**
     * @constructor
     *
     * @param  {Neode}   neode        Neode Instance
     * @param  {Model}   model        Model definition
     * @param  {Integer} identity     Internal Node ID
     * @param  {Array}   labels       Node labels
     * @param  {Object}  properties   Property Map
     * @param  {Map}     eager        Eagerly loaded values
     * @return {Node}
     */
    function Node(neode, model, identity, labels, properties, eager) {
        _classCallCheck(this, Node);

        var _this = _possibleConstructorReturn(this, (Node.__proto__ || Object.getPrototypeOf(Node)).call(this));

        _this._neode = neode;
        _this._model = model;
        _this._identity = identity;
        _this._labels = labels;
        _this._properties = properties || new Map();

        _this._eager = eager || new Map();

        _this._deleted = false;
        return _this;
    }

    /** 
     * Get the Model for this Node
     * 
     * @return {Model}
     */


    _createClass(Node, [{
        key: 'model',
        value: function model() {
            return this._model;
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
         * Set an eager value on the fly
         * 
         * @param  {String} key 
         * @param  {Mixed}  value 
         * @return {Node}
         */

    }, {
        key: 'setEager',
        value: function setEager(key, value) {
            this._eager.set(key, value);

            return this;
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

            return (0, _Delete2.default)(this._neode, this._identity, this._model).then(function () {
                _this2._deleted = true;

                return _this2;
            });
        }

        /**
         * Relate this node to another based on the type
         *
         * @param  {Node}   node            Node to relate to
         * @param  {String} type            Type of Relationship definition
         * @param  {Object} properties      Properties to set against the relationships
         * @param  {Boolean} force_create   Force the creation a new relationship? If false, the relationship will be merged
         * @return {Promise}
         */

    }, {
        key: 'relateTo',
        value: function relateTo(node, type) {
            var properties = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
            var force_create = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

            var relationship = this._model.relationships().get(type);

            if (!(relationship instanceof _RelationshipType2.default)) {
                return Promise.reject(new Error('Cannot find relationship with type ' + type));
            }

            return (0, _RelateTo2.default)(this._neode, this, node, relationship, properties, force_create);
        }

        /**
         * Convert Node to a JSON friendly Object
         *
         * @return {Promise}
         */

    }, {
        key: 'toJson',
        value: function toJson() {
            var _this3 = this;

            var output = {
                _id: this.id(),
                _labels: this.labels()

                // Properties
            };this._model.properties().forEach(function (property, key) {
                if (property.hidden()) {
                    return;
                }

                if (_this3._properties.has(key)) {
                    output[key] = _this3.valueToJson(property, _this3._properties.get(key));
                }
            });

            // Eager Promises
            return Promise.all(this._model.eager().map(function (rel) {
                var key = rel.name();

                if (_this3._eager.has(rel.name())) {
                    // Call internal toJson function on either a Node or NodeCollection
                    return _this3._eager.get(rel.name()).toJson().then(function (value) {
                        return { key: key, value: value };
                    });
                }
            }))
            // Remove Empty 
            .then(function (eager) {
                return eager.filter(function (e) {
                    return !!e;
                });
            })

            // Assign to Output
            .then(function (eager) {
                eager.forEach(function (_ref) {
                    var key = _ref.key,
                        value = _ref.value;
                    return output[key] = value;
                });

                return output;
            });
        }
    }]);

    return Node;
}(_Entity3.default);

exports.default = Node;