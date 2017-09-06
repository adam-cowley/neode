'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.eager = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Node = require('./Node');

var _Node2 = _interopRequireDefault(_Node);

var _NodeCollection = require('./NodeCollection');

var _NodeCollection2 = _interopRequireDefault(_NodeCollection);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var eager = exports.eager = '__eager_';

var Factory = function () {

    /**
     * @constuctor
     *
     * @param Neode neode
     */
    function Factory(neode) {
        _classCallCheck(this, Factory);

        this._neode = neode;
    }

    /**
     * Turn a result node into a
     *
     * @param  {Object} node    Neo4j Node
     * @return {Node|false}
     */


    _createClass(Factory, [{
        key: 'make',
        value: function make(node) {
            var labels = node.labels;
            var definition = this.getDefinition(labels);

            return new _Node2.default(this._neode, definition, node);
        }

        /**
         * Get the definition for a set of labels
         *
         * @param  {Array} labels
         * @return {Definition}
         */

    }, {
        key: 'getDefinition',
        value: function getDefinition(labels) {
            return this._neode.models.getByLabels(labels);
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
            var _this = this;

            var nodes = res.records.map(function (row) {
                var loaded = new Map();
                var node = row.get(alias);

                // Hydrate Eager
                row.keys.forEach(function (key) {
                    if (key.substr(0, eager.length) == eager) {
                        var cleaned_key = key.substr(eager.length);

                        var collection = new _NodeCollection2.default(_this._neode, row.get(key).map(function (node) {
                            return _this.make(node);
                        }));

                        loaded.set(cleaned_key, collection);
                    }
                });

                definition = definition || _this.getDefinition(node.labels);

                return new _Node2.default(_this._neode, definition, node, loaded);
            });

            return new _NodeCollection2.default(this._neode, nodes);
        }

        /**
         * Convert an array of Nodes into a collection
         *
         * @param  {Array}
         * @param  {Definition|null}
         * @return {NodeCollection}
         */

    }, {
        key: 'hydrateAll',
        value: function hydrateAll(nodes, definition) {
            var _this2 = this;

            nodes = nodes.map(function (node) {
                return _this2.make(node, definition);
            });

            return new _NodeCollection2.default(this._neode, nodes);
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
            if (!res.records.length) {
                return false;
            }

            var node = res.records[0].get(alias);

            definition = definition || this.getDefinition(node.labels);

            return new _Node2.default(this._neode, definition, node);
        }
    }]);

    return Factory;
}();

exports.default = Factory;