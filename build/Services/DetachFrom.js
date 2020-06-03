"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = DetachFrom;

function DetachFrom(neode, from, to) {
  var params = {
    from_id: from.identity(),
    to_id: to.identity()
  };
  var query = "\n        MATCH (from)-[rel]-(to)\n        WHERE id(from) = $from_id\n        AND id(to) = $to_id\n        DELETE rel\n    ";
  return neode.writeCypher(query, params).then(function () {
    return [from, to];
  });
}