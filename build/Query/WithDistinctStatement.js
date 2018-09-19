'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WithDistinctStatement = function () {
    function WithDistinctStatement() {
        _classCallCheck(this, WithDistinctStatement);

        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        this._with = args;
    }

    _createClass(WithDistinctStatement, [{
        key: 'toString',
        value: function toString() {
            var vars = this._with.join(',');
            return 'WITH DISTINCT ' + vars;
        }
    }]);

    return WithDistinctStatement;
}();

exports.default = WithDistinctStatement;