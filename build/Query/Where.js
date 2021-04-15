"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = exports.OPERATOR_EQUALS = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var OPERATOR_EQUALS = '=';
exports.OPERATOR_EQUALS = OPERATOR_EQUALS;

var Where = /*#__PURE__*/function () {
  function Where(left, operator, right) {
    _classCallCheck(this, Where);

    this._left = left;
    this._operator = operator;
    this._right = right;
    this._negative = false;
  }

  _createClass(Where, [{
    key: "setNegative",
    value: function setNegative() {
      this._negative = true;
    }
  }, {
    key: "toString",
    value: function toString() {
      var negative = this._negative ? 'NOT ' : '';
      return "".concat(negative).concat(this._left, " ").concat(this._operator, " ").concat(this._right);
    }
  }]);

  return Where;
}();

exports["default"] = Where;