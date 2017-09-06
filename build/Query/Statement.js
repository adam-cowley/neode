'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Relationship = require('./Relationship');

var _Relationship2 = _interopRequireDefault(_Relationship);

var _RelationshipType = require('../RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Statement = function () {
    function Statement(prefix) {
        _classCallCheck(this, Statement);

        this._prefix = prefix || 'MATCH';
        this._match = [];
        this._where = [];
        this._order = [];
        this._return = [];
    }

    _createClass(Statement, [{
        key: 'match',
        value: function match(_match) {
            this._match.push(_match);

            return this;
        }
    }, {
        key: 'where',
        value: function where(_where) {
            this._where.push(_where);

            return this;
        }
    }, {
        key: 'limit',
        value: function limit(_limit) {
            this._limit = _limit;
        }
    }, {
        key: 'skip',
        value: function skip(_skip) {
            this._skip = _skip;
        }
    }, {
        key: 'order',
        value: function order(_order) {
            this._order.push(_order);
        }
    }, {
        key: 'return',
        value: function _return() {
            for (var _len = arguments.length, values = Array(_len), _key = 0; _key < _len; _key++) {
                values[_key] = arguments[_key];
            }

            this._return = this._return.concat(values);

            return this;
        }
    }, {
        key: 'relationship',
        value: function relationship(_relationship, direction, alias, traversals) {
            if (_relationship instanceof _RelationshipType2.default) {
                var rel = _relationship;

                _relationship = rel.relationship();
                direction = rel.direction();
            }

            this._match.push(new _Relationship2.default(_relationship, direction, alias, traversals));

            return this;
        }
    }, {
        key: 'toString',
        value: function toString() {
            var output = [];

            if (this._match.length) {
                output.push(this._prefix);

                output.push(this._match.map(function (statement) {
                    return statement.toString();
                }).join(''));
            }

            if (this._where.length) {
                output.push(this._where.map(function (statement) {
                    return statement.toString();
                }).join(''));
            }

            if (this._return.length) {
                output.push('RETURN');

                output.push(this._return.map(function (output) {
                    return output.toString();
                }));
            }

            if (this._order.length) {
                output.push('ORDER BY');

                output.push(this._order.map(function (output) {
                    return output.toString();
                }));
            }

            if (this._skip) {
                output.push('SKIP ' + this._skip);
            }

            if (this._limit) {
                output.push('LIMIT ' + this._limit);
            }

            return output.join('\n');
        }
    }]);

    return Statement;
}();

exports.default = Statement;