'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = UpdateRelationship;

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function UpdateRelationship(neode, model, identity, properties) {
    var query = '\n        MATCH ()-[rel]->() \n        WHERE id(rel) = {identity} \n        SET rel += {properties} \n        RETURN properties(rel) as properties\n    ';

    return (0, _Validator2.default)(neode, model, properties).then(function (properties) {
        return neode.writeCypher(query, { identity: identity, properties: properties }).then(function (res) {
            return res.records[0].get('properties');
        });
    });
}