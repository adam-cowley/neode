'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = MergeOn;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Node = require('../Node');

var _Node2 = _interopRequireDefault(_Node);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

var _RelationshipType = require('../RelationshipType');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function MergeOn(neode, model, merge_on, properties) {
    return (0, _GenerateDefaultValues2.default)(neode, model, properties).then(function (properties) {
        return (0, _Validator2.default)(neode, model, properties);
    }).then(function (properties) {
        var tx = neode.transaction();
        var match = [];

        var primary_key = model.primaryKey();

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
            if (properties.hasOwnProperty(key) && key !== primary_key) {
                match.push(key + ': {match_' + key + '}');

                params['match_' + key] = properties[key];
            }
        });

        if (match.length == 0 && properties.hasOwnProperty(primary_key)) {
            match.push(primary_key + ': {match_' + primary_key + '}');
            params['match_' + primary_key] = properties[primary_key];
        }

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
            if (property.protected() || property.primary()) {
                params.__on_create_set[key] = value;
            } else if (!property.readonly()) {
                params.__set[key] = value;
            }
        });

        var labels = model.labels().join(":");
        var origin = 'this';
        var query = [];
        var output = [origin];

        query.push('MERGE (' + origin + ':' + labels + ' { ' + match.join(', ') + ' })');

        // Set Properties
        Object.keys(params.__on_create_set).length && query.push('ON CREATE SET ' + origin + ' += {__on_create_set}');
        Object.keys(params.__on_match_set).length && query.push('ON MATCH SET ' + origin + ' += {__on_match_set}');
        Object.keys(params.__set).length && query.push('SET ' + origin + ' += {__set}');

        // Merge relationships
        model.relationships().forEach(function (relationship, key) {
            if (properties.hasOwnProperty(key)) {
                var rels = Array.isArray(properties[key]) ? properties[key] : [properties[key]];

                // TODO: Set property as key
                rels.forEach(function (target, idx) {
                    var alias = relationship.type() + '_' + idx;
                    var direction_in = relationship.direction() == _RelationshipType.DIRECTION_IN ? '<' : '';
                    var direction_out = relationship.direction() == _RelationshipType.DIRECTION_OUT ? '>' : '';

                    if (target instanceof _Node2.default) {
                        query.push('WITH ' + output.join(',') + ' MATCH (' + alias + ') WHERE id(' + alias + ') = {' + alias + '}');
                        query.push('MERGE (' + origin + ')' + direction_in + '-[:' + relationship.relationship() + ']-' + direction_out + '(' + alias + ')');
                        params[alias] = target.idInt();
                    } else if (target instanceof Object) {
                        var alias_match = [];
                        Object.keys(target).forEach(function (key) {
                            var alias_match_key = alias + '_' + key;
                            alias_match.push(key + ':{' + alias_match_key + '}');
                            params[alias_match_key] = target[key];
                        });

                        query.push('WITH ' + output.join(',') + ' MERGE (' + alias + ' { ' + alias_match.join(',') + ' })');
                        query.push('MERGE (' + origin + ')' + direction_in + '-[:' + relationship.relationship() + ']-' + direction_out + '(' + alias + ')');
                    }
                });
            }
        });

        // Output
        query.push('RETURN ' + output.join());

        return neode.writeCypher(query.join(' '), params).then(function (res) {
            tx.success();

            return res.records[0].get(origin);
        });
    });
}