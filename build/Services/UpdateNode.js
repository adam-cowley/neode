'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = UpdateNode;
// TODO: Validation?
function UpdateNode(neode, model, identity, properties) {
    var query = '\n        MATCH (node) \n        WHERE id(node) = {identity} \n        SET node += {properties} \n        RETURN properties(node) as properties\n    ';

    return neode.writeCypher(query, { identity: identity, properties: properties }).then(function (res) {
        return res.records[0].get('properties');
    });
}