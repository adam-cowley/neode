'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _neo4jDriver = require('neo4j-driver');

var _neo4jDriver2 = _interopRequireDefault(_neo4jDriver);

var _Factory = require('./Factory');

var _Factory2 = _interopRequireDefault(_Factory);

var _Model = require('./Model');

var _Model2 = _interopRequireDefault(_Model);

var _ModelMap = require('./ModelMap');

var _ModelMap2 = _interopRequireDefault(_ModelMap);

var _Schema = require('./Schema');

var _Schema2 = _interopRequireDefault(_Schema);

var _TransactionError = require('./TransactionError');

var _TransactionError2 = _interopRequireDefault(_TransactionError);

var _Builder = require('./Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Neode = function () {

    /**
     * Constructor
     *
     * @param  {String} connection_string
     * @param  {String} username
     * @param  {String} password
     * @param  {Bool}   enterprise
     * @return {Neode}
     */
    function Neode(connection_string, username, password) {
        var enterprise = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, Neode);

        var auth = username && password ? _neo4jDriver2.default.auth.basic(username, password) : null;
        this.driver = new _neo4jDriver2.default.driver(connection_string, auth);
        this.models = new _ModelMap2.default(this);
        this.schema = new _Schema2.default(this);
        this.factory = new _Factory2.default(this);

        this.setEnterprise(enterprise);
    }

    /**
     * @static
     * Generate Neode instance using .env configuration
     *
     * @return {Neode}
     */


    _createClass(Neode, [{
        key: 'with',


        /**
         * Define multiple models
         *
         * @param  {Object} models   Map of models with their schema.  ie {Movie: {...}}
         * @return {Neode}
         */
        value: function _with(models) {
            var _this = this;

            Object.keys(models).forEach(function (model) {
                _this.model(model, models[model]);
            });

            return this;
        }

        /**
         * Scan a directory for Models
         *
         * @param  {String} directory   Directory to scan
         * @return {Neode}
         */

    }, {
        key: 'withDirectory',
        value: function withDirectory(directory) {
            var _this2 = this;

            var files = _fs2.default.readdirSync(directory);

            files.forEach(function (file) {
                var model = file.replace('.js', '');
                var path = directory + '/' + file;
                var schema = require(path);

                return _this2.model(model, schema);
            });

            return this;
        }

        /**
         * Set Enterprise Mode
         *
         * @param {Bool} enterprise
         */

    }, {
        key: 'setEnterprise',
        value: function setEnterprise(enterprise) {
            this._enterprise = enterprise;
        }

        /**
         * Are we running in enterprise mode?
         *
         * @return {Bool}
         */

    }, {
        key: 'enterprise',
        value: function enterprise() {
            return this._enterprise;
        }

        /**
         * Define a new Model
         *
         * @param  {String} name
         * @param  {Object} schema
         * @return {Model}
         */

    }, {
        key: 'model',
        value: function model(name, schema) {
            if (schema instanceof Object) {
                var model = new _Model2.default(this, name, schema);
                this.models.set(name, model);
            }

            return this.models.get(name);
        }

        /**
         * Extend a model with extra configuration
         *
         * @param  {String} name   Original Model to clone
         * @param  {String} as     New Model name
         * @param  {Object} using  Schema changes
         * @return {Model}
         */

    }, {
        key: 'extend',
        value: function extend(model, as, using) {
            return this.models.extend(model, as, using);
        }

        /**
         * Create a new Node of a type
         *
         * @param  {String} model
         * @param  {Object} properties
         * @return {Node}
         */

    }, {
        key: 'create',
        value: function create(model, properties) {
            return this.models.get(model).create(properties);
        }

        /**
         * Merge a node based on the defined indexes
         *
         * @param  {Object} properties
         * @return {Promise}
         */

    }, {
        key: 'merge',
        value: function merge(model, properties) {
            return this.model(model).merge(properties);
        }

        /**
         * Merge a node based on the supplied properties
         *
         * @param  {Object} match Specific properties to merge on
         * @param  {Object} set   Properties to set
         * @return {Promise}
         */

    }, {
        key: 'mergeOn',
        value: function mergeOn(model, match, set) {
            return this.model(model).mergeOn(match, set);
        }

        /**
         * Delete a Node from the graph
         *
         * @param  {Node} node
         * @return {Promise}
         */

    }, {
        key: 'delete',
        value: function _delete(node) {
            return node.delete();
        }

        /**
         * Delete all node labels
         *
         * @param  {String} label
         * @return {Promise}
         */

    }, {
        key: 'deleteAll',
        value: function deleteAll(model) {
            return this.models.get(model).deleteAll();
        }

        /**
         * Relate two nodes based on the type
         *
         * @param  {Node}   from        Origin node
         * @param  {Node}   to          Target node
         * @param  {String} type        Type of Relationship definition
         * @param  {Object} properties  Properties to set against the relationships
         * @param  {Boolean} force_create   Force the creation a new relationship? If false, the relationship will be merged
         * @return {Promise}
         */

    }, {
        key: 'relate',
        value: function relate(from, to, type, properties) {
            var force_create = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : false;

            return from.relateTo(to, type, properties, force_create);
        }

        /**
         * Run a Cypher query
         *
         * @param  {String} query
         * @param  {Object} params
         * @return {Promise}
         */

    }, {
        key: 'cypher',
        value: function cypher(query, params) {
            var session = this.driver.session();

            return session.run(query, params).then(function (res) {
                session.close();

                return res;
            }).catch(function (err) {
                session.close();

                throw err;
            });
        }

        /**
         * Create a new Session in the Neo4j Driver.
         *
         * @return {Session}
         */

    }, {
        key: 'session',
        value: function session() {
            return this.driver.session();
        }

        /**
         * Create a new Transaction
         *
         * @return {Transaction}
         */

    }, {
        key: 'transaction',
        value: function transaction() {
            var session = this.driver.session();
            var tx = session.beginTransaction();

            // Create an 'end' function to commit & close the session
            // TODO: Clean up
            tx.success = function () {
                return tx.commit().then(function () {
                    session.close();
                });
            };

            return tx;
        }

        /**
         * Run a batch of queries within a transaction
         *
         * @type {Array}
         * @return {Promise}
         */

    }, {
        key: 'batch',
        value: function batch() {
            var queries = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];

            var tx = this.transaction();
            var output = [];
            var errors = [];

            return Promise.all(queries.map(function (query) {
                var params = (typeof query === 'undefined' ? 'undefined' : _typeof(query)) == 'object' ? query.params : {};
                query = (typeof query === 'undefined' ? 'undefined' : _typeof(query)) == 'object' ? query.query : query;

                try {
                    return tx.run(query, params).then(function (res) {
                        output.push(res);
                    }).catch(function (error) {
                        errors.push({ query: query, params: params, error: error });
                    });
                } catch (error) {
                    errors.push({ query: query, params: params, error: error });
                }
            })).then(function () {
                if (errors.length) {
                    tx.rollback();

                    var error = new _TransactionError2.default(errors);

                    throw error;
                }

                return tx.success().then(function () {
                    return output;
                });
            });
        }

        /**
         * Close Driver
         *
         * @return {void}
         */

    }, {
        key: 'close',
        value: function close() {
            this.driver.close();
        }

        /**
         * Return a new Query Builder
         *
         * @return {Builder}
         */

    }, {
        key: 'query',
        value: function query() {
            return new _Builder2.default();
        }

        /**
         * Get a collection of nodes`
         *
         * @param  {String}              label
         * @param  {Object}              properties
         * @param  {String|Array|Object} order
         * @param  {Int}                 limit
         * @param  {Int}                 skip
         * @return {Promise}
         */

    }, {
        key: 'all',
        value: function all(label, properties, order, limit, skip) {
            return this.models.get(label).all(properties, order, limit, skip);
        }

        /**
         * Find a Node by it's label and primary key
         *
         * @param  {String} label
         * @param  {mixed}  id
         * @return {Promise}
         */

    }, {
        key: 'find',
        value: function find(label, id) {
            return this.models.get(label).find(id);
        }

        /**
         * Find a Node by it's internal node ID
         *
         * @param  {String} model
         * @param  {int}    id
         * @return {Promise}
         */

    }, {
        key: 'findById',
        value: function findById(label, id) {
            return this.models.get(label).findById(id);
        }

        /**
         * Find a Node by properties
         *
         * @param  {String} label
         * @param  {mixed}  key     Either a string for the property name or an object of values
         * @param  {mixed}  value   Value
         * @return {Promise}
         */

    }, {
        key: 'first',
        value: function first(label, key, value) {
            return this.models.get(label).first(key, value);
        }

        /**
         * Hydrate a set of nodes and return a NodeCollection
         *
         * @param  {Object}          res            Neo4j result set
         * @param  {String}          alias          Alias of node to pluck
         * @param  {Definition|null} definition     Force Definition
         * @return {NodeCollection}
         */

    }, {
        key: 'hydrate',
        value: function hydrate(res, alias, definition) {
            return this.factory.hydrate(res, alias, definition);
        }

        /**
         * Hydrate the first record in a result set
         *
         * @param  {Object} res    Neo4j Result
         * @param  {String} alias  Alias of Node to pluck
         * @return {Node}
         */

    }, {
        key: 'hydrateFirst',
        value: function hydrateFirst(res, alias, definition) {
            return this.factory.hydrateFirst(res, alias, definition);
        }
    }], [{
        key: 'fromEnv',
        value: function fromEnv() {
            require('dotenv').config();

            var connection_string = process.env.NEO4J_PROTOCOL + '://' + process.env.NEO4J_HOST + ':' + process.env.NEO4J_PORT;
            var username = process.env.NEO4J_USERNAME;
            var password = process.env.NEO4J_PASSWORD;
            var enterprise = !!process.env.NEO4J_ENTERPRISE;

            return new Neode(connection_string, username, password, enterprise);
        }
    }]);

    return Neode;
}();

exports.default = Neode;


module.exports = Neode;