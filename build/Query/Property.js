'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Property = function () {
    function Property(property, param) {
        var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

        _classCallCheck(this, Property);

        this._property = property;
        this._param = '$' + param || 'null';
        this._operator = operator;
    }

    _createClass(Property, [{
        key: 'toString',
        value: function toString() {
            return (this._property + ' ' + this._operator + ' ' + this._param).trim();
        }
    }, {
        key: 'toInlineString',
        value: function toInlineString() {
            return (this._property + ': ' + this._param).trim();
        }
    }]);

    return Property;
}();

exports.default = Property;