'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Model = require('../Model');

var _Model2 = _interopRequireDefault(_Model);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Match = function () {
    function Match(alias, model) {
        _classCallCheck(this, Match);

        this._alias = alias;
        this._model = model;
    }

    _createClass(Match, [{
        key: 'toString',
        value: function toString() {
            var model = this._model instanceof _Model2.default ? ':' + this._model.labels().join(':') : '';

            // const labels = typeof this._model == 'string' ? this._model : this._model.labels().join(':');

            return '(' + this._alias + model + ')';
        }
    }]);

    return Match;
}();

exports.default = Match;