'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();
// import Return from './Return';


var _Match = require('./Match');

var _Match2 = _interopRequireDefault(_Match);

var _Order = require('./Order');

var _Order2 = _interopRequireDefault(_Order);

var _Statement = require('./Statement');

var _Statement2 = _interopRequireDefault(_Statement);

var _WhereStatement = require('./WhereStatement');

var _WhereStatement2 = _interopRequireDefault(_WhereStatement);

var _Where = require('./Where');

var _Where2 = _interopRequireDefault(_Where);

var _WhereId = require('./WhereId');

var _WhereId2 = _interopRequireDefault(_WhereId);

var _WhereRaw = require('./WhereRaw');

var _WhereRaw2 = _interopRequireDefault(_WhereRaw);

var _WithStatement = require('./WithStatement');

var _WithStatement2 = _interopRequireDefault(_WithStatement);

var _neo4jDriver = require('neo4j-driver');

var _neo4jDriver2 = _interopRequireDefault(_neo4jDriver);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Builder = function () {
    function Builder(neode) {
        _classCallCheck(this, Builder);

        this._neode = neode;

        this._params = {};
        this._statements = [];
        this._current;
        this._where;
    }

    /**
     * Start a new Query segment and set the current statement
     *
     * @return {Builder}
     */


    _createClass(Builder, [{
        key: 'statement',
        value: function statement() {
            if (this._current) {
                this._statements.push(this._current);
            }

            this._current = new _Statement2.default();

            return this;
        }

        /**
         * Start a new Where Segment
         *
         * @return {Builder}
         */

    }, {
        key: 'whereStatement',
        value: function whereStatement(prefix) {
            if (this._where) {
                this._current.where(this._where);
            }

            this._where = new _WhereStatement2.default(prefix);

            return this;
        }

        /**
         * Match a Node by a definition
         *
         * @param  {String} alias      Alias in query
         * @param  {Model}  model      Model definition
         * @return {Builder}           Builder
         */

    }, {
        key: 'match',
        value: function match(alias, model) {
            this.whereStatement('WHERE');
            this.statement();

            this._current.match(new _Match2.default(alias, model));

            return this;
        }

        /**
         * Add a 'with' statement to the query
         *
         * @param  {...String} args Variables/aliases to return
         * @return {Builder}
         */

    }, {
        key: 'with',
        value: function _with() {
            this.whereStatement('WHERE');
            this.statement();

            for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                args[_key] = arguments[_key];
            }

            this._statements.push(new (Function.prototype.bind.apply(_WithStatement2.default, [null].concat(args)))());

            return this;
        }

        /**
         * Create a new WhereSegment
         * @param  {...mixed} args
         * @return {Builder}
         */

    }, {
        key: 'or',
        value: function or() {
            this.whereStatement('OR');

            return this.where.apply(this, arguments);
        }

        /**
         * Add a where condition to the current statement.
         *
         * @param  {...mixed} args Argumenta
         * @return {Builder}         [description]
         */

    }, {
        key: 'where',
        value: function where() {
            var _this = this;

            for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                args[_key2] = arguments[_key2];
            }

            if (!args.length || !args[0]) return this;

            // If 2 character length, it should be straight forward where
            if (args.length == 2) {
                args = [args[0], _Where.OPERATOR_EQUALS, args[1]];
            }

            // If only one argument, treat it as a single string
            if (args.length == 1) {
                var _args = args,
                    _args2 = _slicedToArray(_args, 1),
                    arg = _args2[0];

                if (Array.isArray(arg)) {
                    arg.forEach(function (inner) {
                        _this.where.apply(_this, _toConsumableArray(inner));
                    });
                } else if ((typeof arg === 'undefined' ? 'undefined' : _typeof(arg)) == 'object') {
                    Object.keys(arg).forEach(function (key) {
                        _this.where(key, arg[key]);
                    });
                } else {
                    this._where.append(new _WhereRaw2.default(args[0]));
                }
            } else if (args.length == 1) {
                this._where.append(new _WhereRaw2.default(args[0]));
            } else {
                var _args3 = args,
                    _args4 = _slicedToArray(_args3, 3),
                    left = _args4[0],
                    operator = _args4[1],
                    value = _args4[2];

                var right = ('where_' + left).replace(/([^a-z0-9_]+)/i, '_');

                this._params[right] = value;
                this._where.append(new _Where2.default(left, operator, '{' + right + '}'));
            }

            return this;
        }

        /**
         * Query on Internal ID
         *
         * @param  {String} alias
         * @param  {Int}    value
         * @return {Builder}       [description]
         */

    }, {
        key: 'whereId',
        value: function whereId(alias, value) {
            var param = 'where_id_' + alias;

            this._params[param] = _neo4jDriver2.default.int(value);

            this._where.append(new _WhereId2.default(alias, param));

            return this;
        }

        /**
         * Set Return fields
         *
         * @param  {...mixed} args
         * @return {Builder}
         */

    }, {
        key: 'return',
        value: function _return() {
            var _current;

            (_current = this._current).return.apply(_current, arguments);

            return this;
        }

        /**
         * Set Record Limit
         *
         * @param  {Int} limit
         * @return {Builder}
         */

    }, {
        key: 'limit',
        value: function limit(_limit) {
            this._current.limit(_limit);

            return this;
        }

        /**
         * Set Records to Skip
         *
         * @param  {Int} skip
         * @return {Builder}
         */

    }, {
        key: 'skip',
        value: function skip(_skip) {
            this._current.skip(_skip);

            return this;
        }

        /**
         * Add an order by statement
         *
         * @param  {...String|object} args  Order by statements
         * @return {Builder}
         */

    }, {
        key: 'orderBy',
        value: function orderBy() {
            var _this2 = this;

            for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
                args[_key3] = arguments[_key3];
            }

            var order_by = void 0;

            if (args.length == 2) {
                // Assume orderBy(what, how)
                order_by = new _Order2.default(args[0], args[1]);
            } else if (Array.isArray(args[0])) {
                // Handle array of where's
                args[0].forEach(function (arg) {
                    _this2.orderBy(arg);
                });
            }
            // TODO: Ugly, stop supporting this
            else if (_typeof(args[0]) == 'object' && args[0].field) {
                    // Assume orderBy(args[0].field, args[0].order)
                    order_by = new _Order2.default(args[0].field, args[0].order);
                } else if (_typeof(args[0]) == 'object') {
                    // Assume {key: order}
                    Object.keys(args[0]).forEach(function (key) {
                        _this2.orderBy(key, args[0][key]);
                    });
                } else if (args[0]) {
                    // Assume orderBy(what, 'ASC')
                    order_by = new _Order2.default(args[0]);
                }

            if (order_by) {
                this._current.order(order_by);
            }

            return this;
        }

        /**
         * Build the Query
         *
         * @param  {...String} output References to output
         * @return {Object}           Object containing `query` and `params` property
         */

    }, {
        key: 'build',
        value: function build() {
            // Append Statement to Statements
            this.whereStatement();
            this.statement();

            var query = this._statements.map(function (statement) {
                return statement.toString();
            }).join('\n');

            return {
                query: query,
                params: this._params
            };
        }

        /**
         * Execute the query
         *
         * @return {Promise}
         */

    }, {
        key: 'execute',
        value: function execute() {
            var _build = this.build(),
                query = _build.query,
                params = _build.params;

            return this._neode.cypher(query, params);
        }
    }]);

    return Builder;
}();

exports.default = Builder;