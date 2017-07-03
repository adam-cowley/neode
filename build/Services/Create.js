'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Create;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function Create(neode, model, properties) {
    return (0, _GenerateDefaultValues2.default)(neode, model, properties).then(function (properties) {
        return (0, _Validator2.default)(neode, model, properties);
    }).then(function (properties) {
        // Check we have properties
        if (Object.keys(properties).length == 0) {
            throw new Error('There are no properties set for this Node');
        }

        var labels = model.labels().join(":");
        var query = 'CREATE (node:' + labels + ' {properties}) RETURN node';

        return neode.cypher(query, { properties: properties }).then(function (res) {
            return res.records[0].get('node');
        });
    });
}