'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = MergeOn;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function MergeOn(neode, model, merge_on, properties) {
    return (0, _GenerateDefaultValues2.default)(neode, model, properties).then(function (properties) {
        return (0, _Validator2.default)(neode, model, properties);
    }).then(function (properties) {
        var match = [];

        var params = {
            __set: {},
            __on_match_set: {},
            __on_create_set: {}
        };

        // Check we have properties
        if (Object.keys(properties).length == 0) {
            throw new Error('There are no properties set for this Node');
        }

        // Convert string merge on
        if (!Array.isArray(merge_on)) {
            merge_on = [merge_on];
        }

        // Get Match Properties
        merge_on.forEach(function (key) {
            if (properties.hasOwnProperty(key)) {
                match.push(key + ': {match_' + key + '}');
                params['match_' + key] = properties[key];
            }
        });

        // Throw error if no merge fields are present
        if (!match.length) {
            throw new Error('No merge properties have been supplied');
        }

        // Add properties to params
        model.properties().forEach(function (property, key) {
            // Skip if not set
            if (!properties.hasOwnProperty(key)) {
                return;
            }

            var value = properties[key];

            // Only set protected properties on creation
            if (property.protected()) {
                params.__on_create_set[key] = value;
            } else {
                params.__set[key] = value;
            }
        });

        var labels = model.labels().join(":");
        var query = 'MERGE (node:' + labels + ' { ' + match.join(', ') + ' })\n            ' + (Object.keys(params.__on_create_set).length ? 'ON CREATE SET node += {__on_create_set}' : '') + '\n            ' + (Object.keys(params.__on_match_set).length ? 'ON MATCH SET node += {__on_match_set}' : '') + '\n            ' + (Object.keys(params.__set).length ? 'SET node += {__set}' : '') + '\n            RETURN node';

        return neode.cypher(query, params).then(function (res) {
            return res.records[0].get('node');
        });
    });
}