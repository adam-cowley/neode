'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Update;
function Update(neode, model, node, properties) {
    var query = 'MATCH (node) WHERE id(node) = {identity} SET node += {properties} RETURN node';

    return neode.writeCypher(query, { identity: node.identity, properties: properties }).then(function (res) {
        return res.records[0].get('node');
    });
}