"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _Model = _interopRequireDefault(require("./Model"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _iterableToArrayLimit(arr, i) { if (typeof Symbol === "undefined" || !(Symbol.iterator in Object(arr))) return; var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

function _createForOfIteratorHelper(o) { if (typeof Symbol === "undefined" || o[Symbol.iterator] == null) { if (Array.isArray(o) || (o = _unsupportedIterableToArray(o))) { var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e2) { throw _e2; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var it, normalCompletion = true, didErr = false, err; return { s: function s() { it = o[Symbol.iterator](); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e3) { didErr = true; err = _e3; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }

function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter); }

function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }

function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

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

      var _iterator = _createForOfIteratorHelper(this.models),
          _step;

      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var entry = _step.value;

          var _entry = _slicedToArray(entry, 2),
              name = _entry[0],
              definition = _entry[1]; // eslint-disable-line no-unused-vars


          if (definition.labels().sort().join(':') == labels.sort().join(':')) {
            return definition;
          }
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
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