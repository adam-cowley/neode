"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _Model = _interopRequireDefault(require("../Model"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Create = /*#__PURE__*/function () {
  function Create(alias) {
    var model = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    _classCallCheck(this, Create);

    this._alias = alias;
    this._model = model;
  }

  _createClass(Create, [{
    key: "toString",
    value: function toString() {
      var alias = this._alias || '';
      var model = '';

      if (this._model instanceof _Model["default"]) {
        model = ":".concat(this._model.labels().join(':'));
      } else if (typeof this._model == 'string') {
        model = ":".concat(this._model);
      }

      return "(".concat(alias).concat(model ? model : '', ")");
    }
  }]);

  return Create;
}();

exports["default"] = Create;