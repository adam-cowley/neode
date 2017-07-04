"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WhereId = function () {
    function WhereId(alias, param) {
        _classCallCheck(this, WhereId);

        this._alias = alias;
        this._param = param;
    }

    _createClass(WhereId, [{
        key: "toString",
        value: function toString() {
            return "id(" + this._alias + ") = {" + this._param + "}";
        }
    }]);

    return WhereId;
}();

exports.default = WhereId;