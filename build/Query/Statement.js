'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Relationship = require('./Relationship');

var _Relationship2 = _interopRequireDefault(_Relationship);

var _RelationshipType = require('../RelationshipType');

var _RelationshipType2 = _interopRequireDefault(_RelationshipType);

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Statement = function () {
    function Statement(prefix) {
        _classCallCheck(this, Statement);

        this._prefix = prefix || 'MATCH';
        this._pattern = [];
        this._where = [];
        this._order = [];
        this._detach_delete = [];
        this._delete = [];
        this._return = [];
        this._set = [];
        this._on_create_set = [];
        this._on_match_set = [];
        this._remove = [];
    }

    _createClass(Statement, [{
        key: 'match',
        value: function match(_match) {
            this._pattern.push(_match);

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
        key: 'delete',
        value: function _delete() {
            for (var _len = arguments.length, values = Array(_len), _key = 0; _key < _len; _key++) {
                values[_key] = arguments[_key];
            }

            this._delete = this._delete.concat(values);

            return this;
        }
    }, {
        key: 'detachDelete',
        value: function detachDelete() {
            for (var _len2 = arguments.length, values = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                values[_key2] = arguments[_key2];
            }

            this._detach_delete = this._detach_delete.concat(values);

            return this;
        }
    }, {
        key: 'return',
        value: function _return() {
            for (var _len3 = arguments.length, values = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
                values[_key3] = arguments[_key3];
            }

            this._return = this._return.concat(values);

            return this;
        }
    }, {
        key: 'relationship',
        value: function relationship(_relationship, direction, alias, degrees) {
            if (_relationship instanceof _RelationshipType2.default) {
                var rel = _relationship;

                _relationship = rel.relationship();
                direction = rel.direction();
            }

            this._pattern.push(new _Relationship2.default(_relationship, direction, alias, degrees));

            return this;
        }
    }, {
        key: 'set',
        value: function set(key, value) {
            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            this._set.push(new _Property2.default(key, value, operator));

            return this;
        }
    }, {
        key: 'setRaw',
        value: function setRaw(items) {
            this._set = this._set.concat(items);

            return this;
        }
    }, {
        key: 'onCreateSet',
        value: function onCreateSet(key, value) {
            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            this._on_create_set.push(new _Property2.default(key, value, operator));

            return this;
        }
    }, {
        key: 'onMatchSet',
        value: function onMatchSet(key, value) {
            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            this._on_match_set.push(new _Property2.default(key, value, operator));

            return this;
        }

        /**
         * 
         * @param {Array} items 
         */

    }, {
        key: 'remove',
        value: function remove(items) {
            this._remove = this._remove.concat(items);

            return this;
        }
    }, {
        key: 'toString',
        value: function toString() {
            var includePrefix = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

            var output = [];

            if (this._pattern.length) {
                if (includePrefix) output.push(this._prefix);

                output.push(this._pattern.map(function (statement) {
                    return statement.toString();
                }).join(''));
            }

            if (this._where.length) {
                output.push(this._where.map(function (statement) {
                    return statement.toString();
                }).join(''));
            }

            if (this._remove.length) {
                output.push('REMOVE');

                output.push(this._remove.join(', '));
            }

            if (this._on_create_set.length) {
                output.push('ON CREATE SET');

                output.push(this._on_create_set.map(function (output) {
                    return output.toString();
                }).join(', '));
            }

            if (this._on_match_set.length) {
                output.push('ON MATCH SET');

                output.push(this._on_match_set.map(function (output) {
                    return output.toString();
                }).join(', '));
            }

            if (this._set.length) {
                output.push('SET');

                output.push(this._set.map(function (output) {
                    return output.toString();
                }).join(', '));
            }

            if (this._delete.length) {
                output.push('DELETE');

                output.push(this._delete.map(function (output) {
                    return output.toString();
                }));
            }

            if (this._detach_delete.length) {
                output.push('DETACH DELETE');

                output.push(this._detach_delete.map(function (output) {
                    return output.toString();
                }));
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