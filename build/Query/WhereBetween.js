"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var WhereBetween = /*#__PURE__*/function () {
  function WhereBetween(alias, floor, ceiling) {
    _classCallCheck(this, WhereBetween);

    this._alias = alias;
    this._floor = floor;
    this._ceiling = ceiling;
    this._negative = false;
  }

  _createClass(WhereBetween, [{
    key: "setNegative",
    value: function setNegative() {
      this._negative = true;
    }
  }, {
    key: "toString",
    value: function toString() {
      var negative = this._negative ? 'NOT ' : '';
      return "".concat(negative, "$").concat(this._floor, " <= ").concat(this._alias, " <= $").concat(this._ceiling);
    }
  }]);

  return WhereBetween;
}();

exports["default"] = WhereBetween;