"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var WhereId = /*#__PURE__*/function () {
  function WhereId(alias, param) {
    _classCallCheck(this, WhereId);

    this._alias = alias;
    this._param = param;
    this._negative = false;
  }

  _createClass(WhereId, [{
    key: "setNegative",
    value: function setNegative() {
      this._negative = true;
    }
  }, {
    key: "toString",
    value: function toString() {
      var negative = this._negative ? 'NOT ' : '';
      return "".concat(negative, "id(").concat(this._alias, ") = $").concat(this._param);
    }
  }]);

  return WhereId;
}();

exports["default"] = WhereId;