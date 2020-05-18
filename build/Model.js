"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _Queryable2 = _interopRequireDefault(require("./Queryable"));

var _RelationshipType = _interopRequireWildcard(require("./RelationshipType"));

var _Property = _interopRequireDefault(require("./Property"));

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function _getRequireWildcardCache() { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj["default"] = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _iterableToArrayLimit(arr, i) { if (typeof Symbol === "undefined" || !(Symbol.iterator in Object(arr))) return; var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter); }

function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }

function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function () { var Super = _getPrototypeOf(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = _getPrototypeOf(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

var RELATIONSHIP_TYPES = ['relationship', 'relationships', 'node', 'nodes'];

var Model = /*#__PURE__*/function (_Queryable) {
  _inherits(Model, _Queryable);

  var _super = _createSuper(Model);

  function Model(neode, name, schema) {
    var _this2;

    var _this;

    _classCallCheck(this, Model);

    _this = _super.call(this, neode);
    _this._name = name;
    _this._schema = schema;
    _this._properties = new Map();
    _this._relationships = new Map();
    _this._labels = [name]; // Default Primary Key to {label}_id

    _this._primary_key = name.toLowerCase() + '_id';
    _this._unique = [];
    _this._indexed = [];
    _this._hidden = [];
    _this._readonly = []; // TODO: Clean this up

    for (var key in schema) {
      var value = schema[key];

      switch (key) {
        case 'labels':
          (_this2 = _this).setLabels.apply(_this2, _toConsumableArray(value));

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
    key: "name",
    value: function name() {
      return this._name;
    }
    /**
     * Get Schema
     *
     * @return {Object}
     */

  }, {
    key: "schema",
    value: function schema() {
      return this._schema;
    }
    /**
     * Get a map of Properties
     *
     * @return {Map}
     */

  }, {
    key: "properties",
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
    key: "setLabels",
    value: function setLabels() {
      for (var _len = arguments.length, labels = new Array(_len), _key = 0; _key < _len; _key++) {
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
    key: "labels",
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
    key: "addProperty",
    value: function addProperty(key, schema) {
      var property = new _Property["default"](key, schema);

      this._properties.set(key, property); // Is this key the primary key?


      if (property.primary()) {
        this._primary_key = key;
      } // Is this property unique?


      if (property.unique() || property.primary()) {
        this._unique.push(key);
      } // Is this property indexed?


      if (property.indexed()) {
        this._indexed.push(key);
      } // Should this property be hidden during JSON conversion?


      if (property.hidden()) {
        this._hidden.push(key);
      } // Is this property only to be read and never written to DB (e.g. auto-generated UUIDs)?


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
    key: "relationship",
    value: function relationship(name, type, _relationship) {
      var direction = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : _RelationshipType.DIRECTION_BOTH;
      var target = arguments.length > 4 ? arguments[4] : undefined;
      var schema = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : {};
      var eager = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : false;
      var cascade = arguments.length > 7 && arguments[7] !== undefined ? arguments[7] : false;
      var node_alias = arguments.length > 8 && arguments[8] !== undefined ? arguments[8] : 'node';

      if (_relationship && direction && schema) {
        this._relationships.set(name, new _RelationshipType["default"](name, type, _relationship, direction, target, schema, eager, cascade, node_alias));
      }

      return this._relationships.get(name);
    }
    /**
     * Get all defined Relationships  for this Model
     *
     * @return {Map}
     */

  }, {
    key: "relationships",
    value: function relationships() {
      return this._relationships;
    }
    /**
     * Get relationships defined as Eager relationships
     *
     * @return {Array}
     */

  }, {
    key: "eager",
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
    key: "primaryKey",
    value: function primaryKey() {
      return this._primary_key;
    }
    /**
     * Get array of hidden fields
     *
     * @return {String[]}
     */

  }, {
    key: "hidden",
    value: function hidden() {
      return this._hidden;
    }
    /**
     * Get array of indexed fields
     *
     * @return {String[]}
     */

  }, {
    key: "indexes",
    value: function indexes() {
      return this._indexed;
    }
    /**
     * Get defined merge fields
     *
     * @return {Array}
     */

  }, {
    key: "mergeFields",
    value: function mergeFields() {
      return this._unique.concat(this._indexed);
    }
  }]);

  return Model;
}(_Queryable2["default"]);

exports["default"] = Model;