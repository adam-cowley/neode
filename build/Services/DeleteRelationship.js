"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = DeleteRelationship;
function DeleteRelationship(neode, identity) {
    var query = "\n        MATCH ()-[rel]->() \n        WHERE id(rel) = {identity} \n        DELETE rel\n    ";

    return neode.writeCypher(query, { identity: identity });
}