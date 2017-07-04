'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

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
            var labels = typeof this._model == 'string' ? this._model : this._model.labels().join(':');

            return '(' + this._alias + ':' + labels + ')';
        }
    }]);

    return Match;
}();

exports.default = Match;