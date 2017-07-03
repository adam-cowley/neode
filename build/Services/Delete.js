"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Delete;
function Delete(neode, node) {
    var query = "MATCH (node) WHERE id(node) = {identity} DETACH DELETE node";

    return neode.cypher(query, { identity: node.identity });
}
module.exports = exports["default"];