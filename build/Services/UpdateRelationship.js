"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = UpdateRelationship;

var _CleanValue = _interopRequireDefault(require("./CleanValue"));

var _Validator = _interopRequireDefault(require("./Validator"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function UpdateRelationship(neode, model, identity, properties) {
  var query = "\n        MATCH ()-[rel]->()\n        WHERE id(rel) = $identity\n        SET rel += $properties\n        RETURN properties(rel) as properties\n    "; // Clean up values

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
      return res.records[0].get('properties');
    });
  });
}