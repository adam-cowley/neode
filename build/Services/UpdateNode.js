"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = UpdateNode;

var _Validator = _interopRequireDefault(require("./Validator"));

var _CleanValue = _interopRequireDefault(require("./CleanValue"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function UpdateNode(neode, model, identity, properties) {
  var query = "\n        MATCH (node)\n        WHERE id(node) = $identity\n        SET node += $properties\n        WITH node\n\n        UNWIND keys($properties) AS key\n        RETURN key, node[key] AS value\n    "; // Clean up values

  var schema = model.schema();
  Object.keys(schema).forEach(function (key) {
    var config = typeof schema[key] == 'string' ? {
      type: schema[key]
    } : schema[key]; // Clean Value

    if (properties[key]) {
      properties[key] = (0, _CleanValue["default"])(config, properties[key]);
    }
  });
  return (0, _Validator["default"])(neode, model, properties).then(function (properties) {
    return neode.writeCypher(query, {
      identity: identity,
      properties: properties
    }).then(function (res) {
      return res.records.map(function (row) {
        return {
          key: row.get('key'),
          value: row.get('value')
        };
      });
    });
  });
}