'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Return = function () {
    function Return(alias, as) {
        _classCallCheck(this, Return);

        // TODO: Does alias carry an 'as' value?
        this._alias = alias;
        this._as = as;
    }

    _createClass(Return, [{
        key: 'toString',
        value: function toString() {
            var output = this._alias;

            if (this._as) {
                output += ' AS ' + this._as;
            }

            return output;
        }
    }]);

    return Return;
}();

exports.default = Return;