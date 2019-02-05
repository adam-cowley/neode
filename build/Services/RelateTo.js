'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = RelateTo;

var _RelationshipType = require('../RelationshipType');

var _Relationship = require('../Relationship');

var _Relationship2 = _interopRequireDefault(_Relationship);

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function RelateTo(neode, from, to, relationship, properties) {
    var force_create = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : false;

    return (0, _GenerateDefaultValues2.default)(neode, relationship, properties).then(function (properties) {
        return (0, _Validator2.default)(neode, relationship.schema(), properties);
    }).then(function (properties) {
        var direction_in = relationship.direction() == _RelationshipType.DIRECTION_IN ? '<' : '';
        var direction_out = relationship.direction() == _RelationshipType.DIRECTION_OUT ? '>' : '';
        var type = relationship.relationship();

        var params = {
            from_id: from.identity(),
            to_id: to.identity()
        };
        var set = '';

        if (Object.keys(properties).length) {
            set += 'SET ';
            set += Object.keys(properties).map(function (key) {
                params['set_' + key] = properties[key];
                return 'rel.' + key + ' = {set_' + key + '}';
            }).join(', ');
        }

        var mode = force_create ? 'CREATE' : 'MERGE';

        var query = '\n                MATCH (from), (to)\n                WHERE id(from) = {from_id}\n                AND id(to) = {to_id}\n                ' + mode + ' (from)' + direction_in + '-[rel:' + type + ']-' + direction_out + '(to)\n                ' + set + '\n                RETURN rel\n            ';

        return neode.writeCypher(query, params).then(function (res) {
            var rel = res.records[0].get('rel');
            var hydrate_from = relationship.direction() == _RelationshipType.DIRECTION_IN ? to : from;
            var hydrate_to = relationship.direction() == _RelationshipType.DIRECTION_IN ? from : to;

            var properties = new Map();

            Object.keys(rel.properties).forEach(function (key) {
                properties.set(key, rel.properties[key]);
            });

            return new _Relationship2.default(neode, relationship, rel.identity, rel.type, properties, hydrate_from, hydrate_to);
        });
    });
}