'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WhereBetween = function () {
    function WhereBetween(alias, floor, ceiling) {
        _classCallCheck(this, WhereBetween);

        this._alias = alias;
        this._floor = floor;
        this._ceiling = ceiling;
        this._negative = false;
    }

    _createClass(WhereBetween, [{
        key: 'setNegative',
        value: function setNegative() {
            this._negative = true;
        }
    }, {
        key: 'toString',
        value: function toString() {
            var negative = this._negative ? 'NOT ' : '';

            return negative + '{' + this._floor + '} <= ' + this._alias + ' <= {' + this._ceiling + '}';
        }
    }]);

    return WhereBetween;
}();

exports.default = WhereBetween;