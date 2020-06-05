"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = Detach;

var _RelationshipType = require("../RelationshipType");

function Detach(neode, from, relationship, to) {
  var direction_in = relationship.direction() == _RelationshipType.DIRECTION_IN ? '<' : '';
  var direction_out = relationship.direction() == _RelationshipType.DIRECTION_OUT ? '>' : '';
  var type = relationship.relationship();
  var params = {
    from_id: from.identity()
  };
  var matchClause = "MATCH (from)".concat(direction_in, "-[rel:").concat(type, "]-").concat(direction_out, "(to)\n                       WHERE id(from) = $from_id");

  if (to) {
    params.to_id = to.identity();
    matchClause = "".concat(matchClause, "\n                      AND id(to) = $to_id");
  }

  var query = "\n        ".concat(matchClause, "\n        DELETE rel\n    ");
  return neode.writeCypher(query, params).then(function () {
    return to ? [from, to] : [from];
  });
}