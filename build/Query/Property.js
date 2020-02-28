"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Property = /*#__PURE__*/function () {
  function Property(property, param) {
    var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

    _classCallCheck(this, Property);

    this._property = property;
    this._param = "$".concat(param) || 'null';
    this._operator = operator;
  }

  _createClass(Property, [{
    key: "toString",
    value: function toString() {
      return "".concat(this._property, " ").concat(this._operator, " ").concat(this._param).trim();
    }
  }, {
    key: "toInlineString",
    value: function toInlineString() {
      return "".concat(this._property, ": ").concat(this._param).trim();
    }
  }]);

  return Property;
}();

exports["default"] = Property;