'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); // TODO: Rename this, NodePattern?


var _Model = require('../Model');

var _Model2 = _interopRequireDefault(_Model);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Match = function () {
    function Match(alias) {
        var model = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
        var properties = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

        _classCallCheck(this, Match);

        this._alias = alias;
        this._model = model;
        this._properties = properties;
    }

    _createClass(Match, [{
        key: 'toString',
        value: function toString() {
            var alias = this._alias || '';
            var model = '';
            var properties = '';

            if (this._model instanceof _Model2.default) {
                model = ':' + this._model.labels().join(':');
            } else if (typeof this._model == 'string') {
                model = ':' + this._model;
            }

            if (this._properties.length) {
                properties = ' { ';

                properties += this._properties.map(function (property) {
                    return property.toInlineString();
                }).join(', ');

                properties += ' }';
            }

            return '(' + alias + (model ? model : '') + properties + ')';
        }
    }]);

    return Match;
}();

exports.default = Match;