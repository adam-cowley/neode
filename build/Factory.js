"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _Collection = _interopRequireDefault(require("./Collection"));

var _Node = _interopRequireDefault(require("./Node"));

var _Relationship = _interopRequireDefault(require("./Relationship"));

var _neo4jDriver = _interopRequireDefault(require("neo4j-driver"));

var _EagerUtils = require("./Query/EagerUtils");

var _RelationshipType = require("./RelationshipType");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Factory = /*#__PURE__*/function () {
  /**
   * @constuctor
   *
   * @param Neode neode
   */
  function Factory(neode) {
    _classCallCheck(this, Factory);

    this._neode = neode;
    this._objectsById = [];
    this._objectsAliases = [];
    this._objectsResult = [];
  }
  /**
   * Hydrate all nodes and relations from a result set, return first result
   *
   * @param  {Object} res    Neo4j Result
   * @param  {String} alias  Alias of Node to pluck first
   * @return {Node}
   */


  _createClass(Factory, [{
    key: "hydrateResult",
    value: function hydrateResult(res, alias) {
      var results = this.hydrateResults(res, alias);

      if (results.length > 0) {
        return results[0];
      }

      return null;
    }
    /**
     * Hydrate all nodes and relations from a result set, based on schema
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck first
     * @return {Node}
     */

  }, {
    key: "hydrateResults",
    value: function hydrateResults(res, alias) {
      var _this = this;

      this._objectsById = [];
      this._objectsAliases = [];
      this._objectsResult = [];
      res.records.forEach(function (record) {
        _this._visitedAliases = [];

        _this.hydrateRecord(record, alias);

        _this.hydrateRecordEagers(record, alias);
      });
      return this._objectsResult;
    }
    /**
     * Hydrate nodes and relations from a record result, based on schema
     *
     * @param  {Object} record Neo4j Result Line
     * @param  {String} alias  Alias of Node to pluck first
     * @return {Node}
     */

  }, {
    key: "hydrateRecord",
    value: function hydrateRecord(record, alias) {
      var _this2 = this;

      record.keys.forEach(function (key) {
        var node = record.get(key);

        if (node !== undefined && node.constructor.name == "Node") {
          if (_this2._objectsById[node.identity.toNumber()] !== undefined) {
            return;
          }

          var entity = _this2.hydrateNode(node);

          _this2._objectsById[node.identity.toNumber()] = entity;
          _this2._objectsAliases[node.identity.toNumber()] = key;

          if (key == alias) {
            _this2._objectsResult.push(entity);
          }
        }
      });
    }
    /**
     * Hydrate nodes and relations from a record result, based on schema
     *
     * @param  {Object} record Neo4j Result Line
     * @param  {String} alias  Alias of reference Node
     * @return {Node}
     */

  }, {
    key: "hydrateRecordEagers",
    value: function hydrateRecordEagers(record, alias) {
      var _this3 = this;

      record.keys.forEach(function (key) {
        var relation = record.get(key);

        if (relation === undefined || relation.constructor.name !== "Relationship") {
          return;
        }

        if (_this3._objectsById[relation.identity.toNumber()] !== undefined) {
          return;
        }

        var referenceNode = null;
        var otherNode = null;

        if (record.get(alias).identity.toNumber() == relation.start.toNumber()) {
          referenceNode = _this3._objectsById[relation.start.toNumber()];
          otherNode = _this3._objectsById[relation.end.toNumber()];
        } else if (record.get(alias).identity.toNumber() == relation.end.toNumber()) {
          referenceNode = _this3._objectsById[relation.end.toNumber()];
          otherNode = _this3._objectsById[relation.start.toNumber()];
        } else {
          return;
        }

        var definition = _this3.getDefinition(null, referenceNode.labels());

        definition.eager().forEach(function (eager) {
          if (relation.type != eager.relationship()) {
            return;
          }

          if (otherNode.labels().indexOf(eager.target()) == -1) {
            return;
          }

          var refEager = null;
          var name = eager.name();

          switch (eager.type()) {
            case 'node':
              referenceNode.setEager(name, otherNode);
              break;

            case 'nodes':
              refEager = referenceNode.getEager(name);

              if (refEager === undefined) {
                refEager = new _Collection["default"](_this3._neode);
                referenceNode.setEager(name, refEager);
              }

              refEager.add(otherNode);
              break;

            case 'relationship':
              referenceNode.setEager(name, _this3.hydrateRelationship(eager, relation, referenceNode));
              break;

            case 'relationships':
              refEager = referenceNode.getEager(name);

              if (refEager === undefined) {
                refEager = new _Collection["default"](_this3._neode);
                referenceNode.setEager(name, refEager);
              }

              refEager.add(_this3.hydrateRelationship(eager, relation, referenceNode));
              break;
          }
        });
        _this3._objectsById[relation.identity.toNumber()] = relation;

        _this3._visitedAliases.push(alias);

        var otherAlias = _this3._objectsAliases[otherNode.id()];

        if (_this3._visitedAliases.indexOf(otherAlias) == -1) {
          _this3.hydrateRecordEagers(record, otherAlias);
        }
      });
    }
    /**
     * Hydrate the first record in a result set
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck
     * @return {Node}
     */

  }, {
    key: "hydrateFirst",
    value: function hydrateFirst(res, alias, definition) {
      if (!res || !res.records.length) {
        return false;
      }

      return this.hydrateNode(res.records[0].get(alias), definition);
    }
    /**
     * Hydrate a set of nodes and return a Collection
     *
     * @param  {Object}          res            Neo4j result set
     * @param  {String}          alias          Alias of node to pluck
     * @param  {Definition|null} definition     Force Definition
     * @return {Collection}
     */

  }, {
    key: "hydrate",
    value: function hydrate(res, alias, definition) {
      var _this4 = this;

      if (!res) {
        return false;
      }

      var nodes = res.records.map(function (row) {
        return _this4.hydrateNode(row.get(alias), definition);
      });
      return new _Collection["default"](this._neode, nodes);
    }
    /**
     * Get the definition by a set of labels
     *
     * @param  {Array} labels
     * @return {Model}
     */

  }, {
    key: "getDefinition",
    value: function getDefinition(definition, labels) {
      // Get Definition from
      if (!definition) {
        definition = this._neode.models.getByLabels(labels);
      } else if (typeof definition === 'string') {
        definition = this._neode.models.get(definition);
      } // Helpful error message if nothing could be found


      if (!definition) {
        throw new Error("No model definition found for labels ".concat(JSON.stringify(labels)));
      }

      return definition;
    }
    /**
     * Take a result object and convert it into a Model
     *
     * @param {Object}              record
     * @param {Model|String|null}   definition
     * @return {Node}
     */

  }, {
    key: "hydrateNode",
    value: function hydrateNode(record, definition) {
      var _this5 = this;

      // Is there no better way to check this?!
      if (_neo4jDriver["default"].isInt(record.identity) && Array.isArray(record.labels)) {
        var _Object$assign;

        record = Object.assign({}, record.properties, (_Object$assign = {}, _defineProperty(_Object$assign, _EagerUtils.EAGER_ID, record.identity), _defineProperty(_Object$assign, _EagerUtils.EAGER_LABELS, record.labels), _Object$assign));
      } // Get Internals


      var identity = record[_EagerUtils.EAGER_ID];
      var labels = record[_EagerUtils.EAGER_LABELS]; // Get Definition

      definition = this.getDefinition(definition, labels); // Get Properties

      var properties = new Map();
      definition.properties().forEach(function (value, key) {
        if (record.hasOwnProperty(key)) {
          properties.set(key, record[key]);
        }
      }); // Create Node Instance

      var node = new _Node["default"](this._neode, definition, identity, labels, properties); // Add eagerly loaded props

      definition.eager().forEach(function (eager) {
        var name = eager.name();

        if (!record[name]) {
          return;
        }

        switch (eager.type()) {
          case 'node':
            node.setEager(name, _this5.hydrateNode(record[name]));
            break;

          case 'nodes':
            node.setEager(name, new _Collection["default"](_this5._neode, record[name].map(function (value) {
              return _this5.hydrateNode(value);
            })));
            break;

          case 'relationship':
            node.setEager(name, _this5.hydrateRelationship(eager, record[name], node));
            break;

          case 'relationships':
            node.setEager(name, new _Collection["default"](_this5._neode, record[name].map(function (value) {
              return _this5.hydrateRelationship(eager, value, node);
            })));
            break;
        }
      });
      return node;
    }
    /**
     * Take a result object and convert it into a Relationship
     *
     * @param  {RelationshipType}  definition  Relationship type
     * @param  {Object}            record      Record object
     * @param  {Node}              this_node   'This' node in the current  context
     * @return {Relationship}
     */

  }, {
    key: "hydrateRelationship",
    value: function hydrateRelationship(definition, record, this_node) {
      // Get Internals
      var identity = record[_EagerUtils.EAGER_ID];
      var type = record[_EagerUtils.EAGER_TYPE]; // Get Properties

      var properties = new Map();
      definition.properties().forEach(function (value, key) {
        if (record.hasOwnProperty(key)) {
          properties.set(key, record[key]);
        }
      }); // Start & End Nodes

      var other_node = this.hydrateNode(record[definition.nodeAlias()]); // Calculate Start & End Nodes

      var start_node = definition.direction() == _RelationshipType.DIRECTION_IN ? other_node : this_node;
      var end_node = definition.direction() == _RelationshipType.DIRECTION_IN ? this_node : other_node;
      return new _Relationship["default"](this._neode, definition, identity, type, properties, start_node, end_node);
    }
  }]);

  return Factory;
}();

exports["default"] = Factory;