'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Entity2 = require('./Entity');

var _Entity3 = _interopRequireDefault(_Entity2);

var _RelationshipType = require('./RelationshipType');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Relationship = function (_Entity) {
    _inherits(Relationship, _Entity);

    /**
     * 
     * @param {Neode}            neode          Neode instance
     * @param {RelationshipType} definition     Relationship type definition
     * @param {Integer}          identity       Identity
     * @param {String}           relationship   Relationship type
     * @param {Map}              properties     Map of properties for the relationship
     * @param {Node}             start          Start Node
     * @param {Node}             end            End Node
     * @param {String}           node_alias     Alias given to the Node when converting to JSON
     */
    function Relationship(neode, definition, identity, type, properties, start, end, node_alias) {
        _classCallCheck(this, Relationship);

        var _this = _possibleConstructorReturn(this, (Relationship.__proto__ || Object.getPrototypeOf(Relationship)).call(this));

        _this._neode = neode;
        _this._definition = definition;
        _this._identity = identity;
        _this._type = type;
        _this._properties = properties || new Map();
        _this._start = start;
        _this._end = end;
        _this._node_alias = node_alias;
        return _this;
    }

    /** 
     * Get the definition for this relationship
     * 
     * @return {Definition}
     */


    _createClass(Relationship, [{
        key: 'definition',
        value: function definition() {
            return this._definition;
        }

        /** 
         * Get the relationship type
         */

    }, {
        key: 'type',
        value: function type() {
            return this._type;
        }

        /**
         * Get the start node for this relationship
         * 
         * @return {Node}
         */

    }, {
        key: 'startNode',
        value: function startNode() {
            return this._start;
        }

        /**
         * Get the start node for this relationship
         * 
         * @return {Node}
         */

    }, {
        key: 'endNode',
        value: function endNode() {
            return this._end;
        }

        /** 
         * Get the node on the opposite end of the Relationship to the subject
         * (ie if direction is in, get the end node, otherwise get the start node)
         */

    }, {
        key: 'otherNode',
        value: function otherNode() {
            return this._definition.direction() == _RelationshipType.DIRECTION_IN ? this.startNode() : this.endNode();
        }

        /**
         * Convert Relationship to a JSON friendly Object
         *
         * @return {Promise}
         */

    }, {
        key: 'toJson',
        value: function toJson() {
            var _this2 = this;

            var output = {
                _id: this.id(),
                _type: this.type()
            };

            var definition = this.definition();

            // Properties
            definition.properties().forEach(function (property, key) {
                if (property.hidden()) {
                    return;
                }

                if (_this2._properties.has(key)) {
                    output[key] = _this2.valueToJson(property, _this2._properties.get(key));
                }
            });

            // Get Other Node
            return this.otherNode().toJson().then(function (json) {
                output[definition.nodeAlias()] = json;

                return output;
            });
        }
    }]);

    return Relationship;
}(_Entity3.default);

exports.default = Relationship;