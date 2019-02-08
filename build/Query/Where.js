'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var OPERATOR_EQUALS = exports.OPERATOR_EQUALS = '=';

var Where = function () {
    function Where(left, operator, right) {
        _classCallCheck(this, Where);

        this._left = left;
        this._operator = operator;
        this._right = right;
        this._negative = false;
    }

    _createClass(Where, [{
        key: 'setNegative',
        value: function setNegative() {
            this._negative = true;
        }
    }, {
        key: 'toString',
        value: function toString() {
            var negative = this._negative ? 'NOT ' : '';

            return '' + negative + this._left + ' ' + this._operator + ' ' + this._right;
        }
    }]);

    return Where;
}();

exports.default = Where;