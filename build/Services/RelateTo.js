"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = RelateTo;

var _RelationshipType = require("../RelationshipType");

var _Relationship = _interopRequireDefault(require("../Relationship"));

var _GenerateDefaultValues = _interopRequireDefault(require("./GenerateDefaultValues"));

var _Validator = _interopRequireDefault(require("./Validator"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function RelateTo(neode, from, to, relationship, properties) {
  var force_create = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : false;
  return (0, _GenerateDefaultValues["default"])(neode, relationship, properties).then(function (properties) {
    return (0, _Validator["default"])(neode, relationship.schema(), properties);
  }).then(function (properties) {
    var direction_in = relationship.direction() == _RelationshipType.DIRECTION_IN ? '<' : '';
    var direction_out = relationship.direction() == _RelationshipType.DIRECTION_OUT ? '>' : '';
    var type = relationship.relationship();
    var params = {
      from_id: from.identity(),
      to_id: to.identity()
    };
    var set = '';

    if (Object.keys(properties).length) {
      set += 'SET ';
      set += Object.keys(properties).map(function (key) {
        params["set_".concat(key)] = properties[key];
        return "rel.".concat(key, " = $set_").concat(key);
      }).join(', ');
    }

    var mode = force_create ? 'CREATE' : 'MERGE';
    var query = "\n                MATCH (from), (to)\n                WHERE id(from) = $from_id\n                AND id(to) = $to_id\n                ".concat(mode, " (from)").concat(direction_in, "-[rel:").concat(type, "]-").concat(direction_out, "(to)\n                ").concat(set, "\n                RETURN rel\n            ");
    return neode.writeCypher(query, params).then(function (res) {
      var rel = res.records[0].get('rel');
      var hydrate_from = relationship.direction() == _RelationshipType.DIRECTION_IN ? to : from;
      var hydrate_to = relationship.direction() == _RelationshipType.DIRECTION_IN ? from : to;
      var properties = new Map();
      Object.keys(rel.properties).forEach(function (key) {
        properties.set(key, rel.properties[key]);
      });
      return new _Relationship["default"](neode, relationship, rel.identity, rel.type, properties, hydrate_from, hydrate_to);
    });
  });
}