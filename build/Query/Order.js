"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Order = /*#__PURE__*/function () {
  function Order(what, how) {
    _classCallCheck(this, Order);

    this._what = what;
    this._how = how || '';
  }

  _createClass(Order, [{
    key: "toString",
    value: function toString() {
      return "".concat(this._what, " ").concat(this._how).trim();
    }
  }]);

  return Order;
}();

exports["default"] = Order;