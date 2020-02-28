"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _Model = _interopRequireDefault(require("./Model"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { if (!(Symbol.iterator in Object(arr) || Object.prototype.toString.call(arr) === "[object Arguments]")) { return; } var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance"); }

function _iterableToArray(iter) { if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter); }

function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var ModelMap = /*#__PURE__*/function () {
  /**
   * @constuctor
   *
   * @param {Neode} neode
   */
  function ModelMap(neode) {
    _classCallCheck(this, ModelMap);

    this._neode = neode;
    this.models = new Map();
  }
  /**
   * Check if a model has been defined
   *
   * @param  {String} key
   * @return {bool}
   */


  _createClass(ModelMap, [{
    key: "has",
    value: function has(key) {
      return this.models.has(key);
    }
    /**
     * Namesof the models defined.
     *
     * @return {Array<String>}
     */

  }, {
    key: "keys",
    value: function keys() {
      return _toConsumableArray(this.models.keys());
    }
    /**
     * Getter
     *
     * @param  {String}
     * @return {Model|false}
     */

  }, {
    key: "get",
    value: function get(key) {
      return this.models.get(key);
    }
    /**
     * Setter
     *
     * @param  {String} key
     * @param  {Model}  value
     * @return {ModelMap}
     */

  }, {
    key: "set",
    value: function set(key, value) {
      this.models.set(key, value);
      return this;
    }
    /**
     * Run a forEach function on the models
     *
     * @param  {Function}
     * @return {void}
     */

  }, {
    key: "forEach",
    value: function forEach(fn) {
      return this.models.forEach(fn);
    }
    /**
     * Get the definition for an array labels
     *
     * @param  {Array} labels
     * @return {Definition}
     */

  }, {
    key: "getByLabels",
    value: function getByLabels(labels) {
      if (!Array.isArray(labels)) {
        labels = [labels];
      }

      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = this.models[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var entry = _step.value;

          var _entry = _slicedToArray(entry, 2),
              name = _entry[0],
              definition = _entry[1]; // eslint-disable-line no-unused-vars


          if (definition.labels().sort().join(':') == labels.sort().join(':')) {
            return definition;
          }
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator["return"] != null) {
            _iterator["return"]();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      return false;
    }
    /**
     * Extend a model with extra configuration
     *
     * @param  {String} name   Original Model to clone
     * @param  {String} as     New Model name
     * @param  {Object} using  Schema changes
     * @return {Model}
     */

  }, {
    key: "extend",
    value: function extend(name, as, using) {
      // Get Original Model
      var original = this.models.get(name); // Add new Labels

      var labels = original.labels().slice(0);
      labels.push(as);
      labels.sort(); // Merge Schema

      var schema = Object.assign({}, original.schema(), using); // Create and set

      var model = new _Model["default"](this._neode, as, schema);
      model.setLabels.apply(model, _toConsumableArray(labels));
      this.models.set(as, model);
      return model;
    }
  }]);

  return ModelMap;
}();

exports["default"] = ModelMap;