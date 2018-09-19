'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = UpdateRelationship;
// TODO: Validation?
function UpdateRelationship(neode, model, identity, properties) {
    var query = '\n        MATCH ()-[rel]->() \n        WHERE id(rel) = {identity} \n        SET rel += {properties} \n        RETURN properties(rel) as properties\n    ';

    return neode.writeCypher(query, { identity: identity, properties: properties }).then(function (res) {
        return res.records[0].get('properties');
    });
}