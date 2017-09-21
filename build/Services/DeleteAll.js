'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = DeleteAll;
// TODO : Delete Dependencies

function DeleteAll(neode, model) {
    var query = 'MATCH (node:' + model.labels().join(':') + ') DETACH DELETE node';

    return neode.writeCypher(query);
}