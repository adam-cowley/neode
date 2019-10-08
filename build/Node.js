'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _neo4jDriver = require('neo4j-driver');

var _Entity2 = require('./Entity');

var _Entity3 = _interopRequireDefault(_Entity2);

var _UpdateNode = require('./Services/UpdateNode');

var _UpdateNode2 = _interopRequireDefault(_UpdateNode);

var _DeleteNode = require('./Services/DeleteNode');

var _DeleteNode2 = _interopRequireDefault(_DeleteNode);

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
         * @param {Integer} to_depth    Depth to delete to (Defaults to 10)
         * @return {Promise}
         */

    }, {
        key: 'delete',
        value: function _delete(to_depth) {
            var _this2 = this;

            return (0, _DeleteNode2.default)(this._neode, this._identity, this._model, to_depth).then(function () {
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
            var _this3 = this;

            var properties = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
            var force_create = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

            var relationship = this._model.relationships().get(type);

            if (!(relationship instanceof _RelationshipType2.default)) {
                return Promise.reject(new Error('Cannot find relationship with type ' + type));
            }

            return (0, _RelateTo2.default)(this._neode, this, node, relationship, properties, force_create).then(function (rel) {
                _this3._eager.delete(type);

                return rel;
            });
        }

        /**
         * Convert Node to a JSON friendly Object
         *
         * @return {Promise}
         */

    }, {
        key: 'toJson',
        value: function toJson() {
            var _this4 = this;

            var output = {
                _id: this.id(),
                _labels: this.labels()
            };

            // Properties
            this._model.properties().forEach(function (property, key) {
                if (property.hidden()) {
                    return;
                }

                if (_this4._properties.has(key)) {
                    output[key] = _this4.valueToJson(property, _this4._properties.get(key));
                } else if (_neo4jDriver.v1.temporal.isDateTime(output[key])) {
                    output[key] = new Date(output[key].toString());
                } else if (_neo4jDriver.v1.spatial.isPoint(output[key])) {
                    switch (output[key].srid.toString()) {
                        // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
                        case '4326':
                            // WGS 84 2D
                            output[key] = { longitude: output[key].x, latitude: output[key].y };
                            break;

                        case '4979':
                            // WGS 84 3D
                            output[key] = { longitude: output[key].x, latitude: output[key].y, height: output[key].z };
                            break;

                        case '7203':
                            // Cartesian 2D
                            output[key] = { x: output[key].x, y: output[key].y };
                            break;

                        case '9157':
                            // Cartesian 3D
                            output[key] = { x: output[key].x, y: output[key].y, z: output[key].z };
                            break;
                    }
                }
            });

            // Eager Promises
            return Promise.all(this._model.eager().map(function (rel) {
                var key = rel.name();

                if (_this4._eager.has(rel.name())) {
                    // Call internal toJson function on either a Node or NodeCollection
                    return _this4._eager.get(rel.name()).toJson().then(function (value) {
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

        /**
         * Update the properties for this node
         *
         * @param {Object} properties  New properties
         * @return {Node}
         */

    }, {
        key: 'update',
        value: function update(properties) {
            var _this5 = this;

            // TODO: Temporary fix, add the properties to the properties map
            // Sorry, but it's easier than hacking the validator
            this._model.properties().forEach(function (property) {
                var name = property.name();

                if (property.required() && !properties.hasOwnProperty(name)) {
                    properties[name] = _this5._properties.get(name);
                }
            });

            return (0, _UpdateNode2.default)(this._neode, this._model, this._identity, properties).then(function (properties) {
                Object.entries(properties).forEach(function (_ref2) {
                    var _ref3 = _slicedToArray(_ref2, 2),
                        key = _ref3[0],
                        value = _ref3[1];

                    _this5._properties.set(key, value);
                });
            }).then(function () {
                return _this5;
            });
        }
    }]);

    return Node;
}(_Entity3.default);

exports.default = Node;