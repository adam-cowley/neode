"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = exports.CONNECTOR_OR = exports.CONNECTOR_AND = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var CONNECTOR_AND = 'AND';
exports.CONNECTOR_AND = CONNECTOR_AND;
var CONNECTOR_OR = 'OR';
exports.CONNECTOR_OR = CONNECTOR_OR;

var WhereStatement = /*#__PURE__*/function () {
  function WhereStatement(prefix) {
    _classCallCheck(this, WhereStatement);

    this._prefix = prefix || '';
    this._clauses = [];
    this._connector = CONNECTOR_AND;
  }
  /**
   * Set the Connector string for chaining statements (AND, OR)
   * 
   * @param {String} connector 
   */


  _createClass(WhereStatement, [{
    key: "setConnector",
    value: function setConnector(connector) {
      this._connector = connector;
    }
    /**
     * Append a new clause
     *
     * @param  {Where}  clause  Where clause to append
     * @return {WhereStatement}
     */

  }, {
    key: "append",
    value: function append(clause) {
      this._clauses.push(clause);

      return this;
    }
    /** 
     * Return the last condition in the collection
     * 
     * @return {Where}
     */

  }, {
    key: "last",
    value: function last() {
      return this._clauses[this._clauses.length - 1];
    }
    /**
     * Convert this Where Statement to a String
     *
     * @return {String}
     */

  }, {
    key: "toString",
    value: function toString() {
      if (!this._clauses.length) return;

      var statements = this._clauses.map(function (clause) {
        return clause.toString();
      }).join(' ' + this._connector + ' ');

      return "".concat(this._prefix, " (").concat(statements, ") ");
    }
  }]);

  return WhereStatement;
}();

exports["default"] = WhereStatement;