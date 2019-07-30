'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.mode = undefined;

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

var _Property = require('./Property');

var _Property2 = _interopRequireDefault(_Property);

var _WhereStatement = require('./WhereStatement');

var _WhereStatement2 = _interopRequireDefault(_WhereStatement);

var _Where = require('./Where');

var _Where2 = _interopRequireDefault(_Where);

var _WhereBetween = require('./WhereBetween');

var _WhereBetween2 = _interopRequireDefault(_WhereBetween);

var _WhereId = require('./WhereId');

var _WhereId2 = _interopRequireDefault(_WhereId);

var _WhereRaw = require('./WhereRaw');

var _WhereRaw2 = _interopRequireDefault(_WhereRaw);

var _WithStatement = require('./WithStatement');

var _WithStatement2 = _interopRequireDefault(_WithStatement);

var _WithDistinctStatement = require('./WithDistinctStatement');

var _WithDistinctStatement2 = _interopRequireDefault(_WithDistinctStatement);

var _neo4jDriver = require('neo4j-driver');

var _neo4jDriver2 = _interopRequireDefault(_neo4jDriver);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var mode = exports.mode = {
    READ: "READ",
    WRITE: "WRITE"
};

var Builder = function () {
    function Builder(neode) {
        _classCallCheck(this, Builder);

        this._neode = neode;

        this._params = {};
        this._statements = [];
        this._current;
        this._where;
        this._set_count = 0;
    }

    /**
     * Start a new Query segment and set the current statement
     *
     * @return {Builder}
     */


    _createClass(Builder, [{
        key: 'statement',
        value: function statement(prefix) {
            if (this._current) {
                this._statements.push(this._current);
            }

            this._current = new _Statement2.default(prefix);

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
         * @param  {String} alias           Alias in query
         * @param  {Model|String}  model    Model definition
         * @param  {Object|null}   properties   Inline Properties
         * @return {Builder}                Builder
         */

    }, {
        key: 'match',
        value: function match(alias, model, properties) {
            this.whereStatement('WHERE');
            this.statement();

            this._current.match(new _Match2.default(alias, model, this._convertPropertyMap(alias, properties)));

            return this;
        }
    }, {
        key: 'optionalMatch',
        value: function optionalMatch(alias, model) {
            this.whereStatement('WHERE');
            this.statement('OPTIONAL MATCH');

            this._current.match(new _Match2.default(alias, model));

            return this;
        }

        /**
         * Add a 'with' statement to the query
         *
         * @param  {...String} args Variables/aliases to carry through
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
         * Add a 'with distinct' statement to the query
         *
         * @param  {...String} args Variables/aliases to carry through
         * @return {Builder}
         */

    }, {
        key: 'withDistinct',
        value: function withDistinct() {
            this.whereStatement('WHERE');
            this.statement();

            for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                args[_key2] = arguments[_key2];
            }

            this._statements.push(new (Function.prototype.bind.apply(_WithDistinctStatement2.default, [null].concat(args)))());

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
         * Generate a unique key and add the value to the params object
         *
         * @param {String} key
         * @param {Mixed} value
         */

    }, {
        key: '_addWhereParameter',
        value: function _addWhereParameter(key, value) {
            var attempt = 1;
            var base = 'where_' + key.replace(/[^a-z0-9]+/, '_');

            // Try to create a unique key
            var variable = base;

            while (typeof this._params[variable] != "undefined") {
                attempt++;

                variable = base + '_' + attempt;
            }

            this._params[variable] = value;

            return variable;
        }

        /**
         * Add a where condition to the current statement.
         *
         * @param  {...mixed} args Arguments
         * @return {Builder}
         */

    }, {
        key: 'where',
        value: function where() {
            var _this = this;

            for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
                args[_key3] = arguments[_key3];
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
            } else {
                var _args3 = args,
                    _args4 = _slicedToArray(_args3, 3),
                    left = _args4[0],
                    operator = _args4[1],
                    value = _args4[2];

                var right = this._addWhereParameter(left, value);

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
         * @return {Builder}
         */

    }, {
        key: 'whereId',
        value: function whereId(alias, value) {
            var param = this._addWhereParameter(alias + '_id', _neo4jDriver2.default.int(value));

            this._where.append(new _WhereId2.default(alias, param));

            return this;
        }

        /**
         * Add a raw where clause
         *
         * @param  {String} clause
         * @return {Builder}
         */

    }, {
        key: 'whereRaw',
        value: function whereRaw(clause) {
            this._where.append(new _WhereRaw2.default(clause));

            return this;
        }

        /**
         * A negative where clause
         *
         * @param {*} args
         * @return {Builder}
         */

    }, {
        key: 'whereNot',
        value: function whereNot() {
            this.where.apply(this, arguments);

            this._where.last().setNegative();

            return this;
        }

        /**
         * Between clause
         *
         * @param {String} alias
         * @param {Mixed} floor
         * @param {Mixed} ceiling
         * @return {Builder}
         */

    }, {
        key: 'whereBetween',
        value: function whereBetween(alias, floor, ceiling) {
            var floor_alias = this._addWhereParameter(alias + '_floor', floor);
            var ceiling_alias = this._addWhereParameter(alias + '_ceiling', ceiling);

            this._where.append(new _WhereBetween2.default(alias, floor_alias, ceiling_alias));

            return this;
        }

        /**
         * Negative Between clause
         *
         * @param {String} alias
         * @param {Mixed} floor
         * @param {Mixed} ceiling
         * @return {Builder}
         */

    }, {
        key: 'whereNotBetween',
        value: function whereNotBetween(alias, floor, ceiling) {
            this.whereBetween(alias, floor, ceiling);

            this._where.last().setNegative();

            return this;
        }

        /**
         * Set Delete fields
         *
         * @param  {...mixed} args
         * @return {Builder}
         */

    }, {
        key: 'delete',
        value: function _delete() {
            var _current;

            (_current = this._current).delete.apply(_current, arguments);

            return this;
        }

        /**
         * Set Detach Delete fields
         *
         * @param  {...mixed} args
         * @return {Builder}
         */

    }, {
        key: 'detachDelete',
        value: function detachDelete() {
            var _current2;

            (_current2 = this._current).detachDelete.apply(_current2, arguments);

            return this;
        }

        /**
         * Start a Create Statement by alias/definition
         *
         * @param  {String} alias               Alias in query
         * @param  {Model|String}  model        Model definition
         * @param  {Object|null}   properties   Inline Properties
         * @return {Builder}                    Builder
         */

    }, {
        key: 'create',
        value: function create(alias, model, properties) {
            this.whereStatement('WHERE');
            this.statement('CREATE');

            this._current.match(new _Match2.default(alias, model, this._convertPropertyMap(alias, properties)));

            return this;
        }

        /**
         * Convert a map of properties into an Array of
         *
         * @param {Object|null} properties
         */

    }, {
        key: '_convertPropertyMap',
        value: function _convertPropertyMap(alias, properties) {
            var _this2 = this;

            if (properties) {
                return Object.keys(properties).map(function (key) {
                    var property_alias = alias + '_' + key;

                    _this2._params[property_alias] = properties[key];

                    return new _Property2.default(key, property_alias);
                });
            }

            return [];
        }

        /**
         * Start a Merge Statement by alias/definition
         *
         * @param  {String}        alias        Alias in query
         * @param  {Model|String}  model        Model definition
         * @param  {Object|null}   properties   Inline Properties
         * @return {Builder}                    Builder
         */

    }, {
        key: 'merge',
        value: function merge(alias, model, properties) {
            this.whereStatement('WHERE');
            this.statement('MERGE');

            this._current.match(new _Match2.default(alias, model, this._convertPropertyMap(alias, properties)));

            return this;
        }

        /**
         * Set a property
         *
         * @param {String|Object} property   Property in {alias}.{property} format
         * @param {Mixed}         value      Value
         * @param {String}        operator   Operator
         */

    }, {
        key: 'set',
        value: function set(property, value) {
            var _this3 = this;

            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            // Support a map of properties
            if (!value && property instanceof Object) {
                Object.keys(property).forEach(function (key) {
                    _this3.set(key, property[key]);
                });
            } else {
                if (value !== undefined) {
                    var alias = 'set_' + this._set_count;
                    this._params[alias] = value;

                    this._set_count++;

                    this._current.set(property, alias, operator);
                } else {
                    this._current.setRaw(property);
                }
            }

            return this;
        }

        /**
         * Set a property
         *
         * @param {String|Object} property   Property in {alias}.{property} format
         * @param {Mixed}         value      Value
         * @param {String}        operator   Operator
         */

    }, {
        key: 'onCreateSet',
        value: function onCreateSet(property, value) {
            var _this4 = this;

            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            // Support a map of properties
            if (value === undefined && property instanceof Object) {
                Object.keys(property).forEach(function (key) {
                    _this4.onCreateSet(key, property[key]);
                });
            } else {
                var alias = 'set_' + this._set_count;
                this._params[alias] = value;

                this._set_count++;

                this._current.onCreateSet(property, alias, operator);
            }

            return this;
        }

        /**
         * Set a property
         *
         * @param {String|Object} property   Property in {alias}.{property} format
         * @param {Mixed}         value      Value
         * @param {String}        operator   Operator
         */

    }, {
        key: 'onMatchSet',
        value: function onMatchSet(property, value) {
            var _this5 = this;

            var operator = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '=';

            // Support a map of properties
            if (value === undefined && property instanceof Object) {
                Object.keys(property).forEach(function (key) {
                    _this5.onMatchSet(key, property[key]);
                });
            } else {
                var alias = 'set_' + this._set_count;
                this._params[alias] = value;

                this._set_count++;

                this._current.onMatchSet(property, alias, operator);
            }

            return this;
        }

        /**
         * Remove properties or labels in {alias}.{property}
         * or {alias}:{Label} format
         *
         * @param {[String]} items
         */

    }, {
        key: 'remove',
        value: function remove() {
            for (var _len4 = arguments.length, items = Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
                items[_key4] = arguments[_key4];
            }

            this._current.remove(items);

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
            var _current3;

            (_current3 = this._current).return.apply(_current3, arguments);

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
            var _this6 = this;

            for (var _len5 = arguments.length, args = Array(_len5), _key5 = 0; _key5 < _len5; _key5++) {
                args[_key5] = arguments[_key5];
            }

            var order_by = void 0;

            if (args.length == 2) {
                // Assume orderBy(what, how)
                order_by = new _Order2.default(args[0], args[1]);
            } else if (Array.isArray(args[0])) {
                // Handle array of where's
                args[0].forEach(function (arg) {
                    _this6.orderBy(arg);
                });
            }
            // TODO: Ugly, stop supporting this
            else if (_typeof(args[0]) == 'object' && args[0].field) {
                    // Assume orderBy(args[0].field, args[0].order)
                    order_by = new _Order2.default(args[0].field, args[0].order);
                } else if (_typeof(args[0]) == 'object') {
                    // Assume {key: order}
                    Object.keys(args[0]).forEach(function (key) {
                        _this6.orderBy(key, args[0][key]);
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
         * Add a relationship to the query
         *
         * @param  {String|RelationshipType} relationship  Relationship name or RelationshipType object
         * @param  {String}                  direction     Direction of relationship DIRECTION_IN, DIRECTION_OUT
         * @param  {String|null}             alias         Relationship alias
         * @param  {Int|String}              degrees        Number of traversdegreesals (1, "1..2", "0..2", "..3")
         * @return {Builder}
         */

    }, {
        key: 'relationship',
        value: function relationship(_relationship, direction, alias, degrees) {
            this._current.relationship(_relationship, direction, alias, degrees);

            return this;
        }

        /**
         * Complete a relationship
         * @param  {String} alias       Alias
         * @param  {Model}  model       Model definition
         * @param  {Object} properties  Properties
         * @return {Builder}
         */

    }, {
        key: 'to',
        value: function to(alias, model, properties) {
            this._current.match(new _Match2.default(alias, model, this._convertPropertyMap(alias, properties)));

            return this;
        }

        /**
         * Complete the relationship statement to point to anything
         *
         * @return {Builder}
         */

    }, {
        key: 'toAnything',
        value: function toAnything() {
            this._current.match(new _Match2.default());

            return this;
        }

        /**
         * Build the pattern without any keywords
         *
         * @return {String}
         */

    }, {
        key: 'pattern',
        value: function pattern() {
            this.whereStatement();
            this.statement();

            return this._statements.map(function (statement) {
                return statement.toString(false);
            }).join('\n');
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
         * @param  {String}  query_mode
         * @return {Promise}
         */

    }, {
        key: 'execute',
        value: function execute() {
            var query_mode = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : mode.WRITE;

            var _build = this.build(),
                query = _build.query,
                params = _build.params;

            switch (query_mode) {
                case mode.WRITE:
                    return this._neode.writeCypher(query, params);

                default:
                    return this._neode.cypher(query, params);
            }
        }
    }]);

    return Builder;
}();

exports.default = Builder;