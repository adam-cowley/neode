'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Create;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Node = require('../Node');

var _Node2 = _interopRequireDefault(_Node);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

var _RelationshipType = require('../RelationshipType');

var _EagerUtils = require('../Query/EagerUtils');

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
        var origin = 'this';
        var output = [origin];

        var params = {
            __set: {}
        };

        // Add properties to params
        model.properties().forEach(function (property, key) {
            // Skip if not set
            if (!properties.hasOwnProperty(key)) {
                return;
            }

            var value = properties[key];

            // Warning: Only set protected properties on creation
            params.__set[key] = value;
        });

        // Start Query
        var query = [];
        query.push('CREATE (' + origin + ':' + labels + ' {__set})');

        // TODO: Rewrite

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

        query.push('RETURN ' + (0, _EagerUtils.eagerNode)(neode, 1, origin, model));

        return neode.writeCypher(query.join(' '), params).then(function (res) {
            return neode.hydrateFirst(res, origin, model);
        });
    });
}