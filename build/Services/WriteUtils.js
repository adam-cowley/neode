'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ORIGINAL_ALIAS = exports.MAX_CREATE_DEPTH = undefined;

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

exports.addNodeToStatement = addNodeToStatement;
exports.addRelationshipToStatement = addRelationshipToStatement;
exports.addNodeRelationshipToStatement = addNodeRelationshipToStatement;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Node = require('../Node');

var _Node2 = _interopRequireDefault(_Node);

var _Entity = require('../Entity');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var MAX_CREATE_DEPTH = exports.MAX_CREATE_DEPTH = 99;
var ORIGINAL_ALIAS = exports.ORIGINAL_ALIAS = 'this';

/**
 * Split properties into
 *
 * @param  {String}  mode        'create' or 'merge'
 * @param  {Model}   model        Model to merge on
 * @param  {Object}  properties   Map of properties
 * @param  {Array}   merge_on     Array of properties explicitly stated to merge on
 * @return {Object}               { inline, set, on_create, on_match }
 */
function splitProperties(mode, model, properties) {
    var merge_on = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : [];

    var inline = {};
    var set = {};
    var on_create = {};
    var on_match = {};

    // Calculate Set Properties
    model.properties().forEach(function (property) {
        var name = property.name();

        // Skip if not set
        if (!properties.hasOwnProperty(name)) {
            return;
        }

        var value = (0, _Entity.valueToCypher)(property, properties[name]);

        // If mode is create, go ahead and set everything
        if (mode == 'create') {
            inline[name] = value;
        } else if (merge_on.indexOf(name) > -1) {
            inline[name] = value;
        }

        // Only set protected properties on creation
        else if (property.protected() || property.primary()) {
                on_create[name] = value;
            }

            // Read-only property?
            else if (!property.readonly()) {
                    set[name] = value;
                }
    });

    return {
        inline: inline,
        on_create: on_create,
        on_match: on_match,
        set: set
    };
}

/**
 * Add a node to the current statement
 *
 * @param {Neode}   neode       Neode instance
 * @param {Builder} builder     Query builder
 * @param {String}  alias       Alias
 * @param {Model}   model       Model
 * @param {Object}  properties  Map of properties
 * @param {Array}   aliases     Aliases to carry through in with statement
 * @param {String}  mode        'create' or 'merge'
 * @param {Array}   merge_on    Which properties should we merge on?
 */
function addNodeToStatement(neode, builder, alias, model, properties) {
    var aliases = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : [];
    var mode = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : 'create';
    var merge_on = arguments.length > 7 && arguments[7] !== undefined ? arguments[7] : [];

    // Split Properties
    var _splitProperties = splitProperties(mode, model, properties, merge_on),
        inline = _splitProperties.inline,
        on_create = _splitProperties.on_create,
        on_match = _splitProperties.on_match,
        set = _splitProperties.set;

    // Add alias


    if (aliases.indexOf(alias) == -1) {
        aliases.push(alias);
    }

    // Create
    builder[mode](alias, model, inline);

    // On create set
    if (Object.keys(on_create).length) {
        Object.entries(on_create).forEach(function (_ref) {
            var _ref2 = _slicedToArray(_ref, 2),
                key = _ref2[0],
                value = _ref2[1];

            builder.onCreateSet(alias + '.' + key, value);
        });
    }

    // On Match Set
    if (Object.keys(on_match).length) {
        Object.entries(on_match).forEach(function (_ref3) {
            var _ref4 = _slicedToArray(_ref3, 2),
                key = _ref4[0],
                value = _ref4[1];

            builder.onCreateSet(alias + '.' + key, value);
        });
    }

    // Set
    if (Object.keys(set).length) {
        Object.entries(set).forEach(function (_ref5) {
            var _ref6 = _slicedToArray(_ref5, 2),
                key = _ref6[0],
                value = _ref6[1];

            builder.set(alias + '.' + key, value);
        });
    }

    // Relationships
    model.relationships().forEach(function (relationship, key) {
        if (properties.hasOwnProperty(key)) {
            var value = properties[key];

            var rel_alias = alias + '_' + key + '_rel';
            var target_alias = alias + '_' + key + '_node';

            // Carry alias through
            builder.with.apply(builder, _toConsumableArray(aliases));

            if (!relationship.target()) {
                throw new Error('A target defintion must be defined for ' + key + ' on model ' + model.name());
            } else if (Array.isArray(relationship.target())) {
                throw new Error('You cannot create a node with the ambiguous relationship: ' + key + ' on model ' + model.name());
            }

            switch (relationship.type()) {
                // Single Relationship
                case 'relationship':
                    addRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases, mode);
                    break;

                // Array of Relationships
                case 'relationships':
                    if (!Array.isArray(value)) value = [value];

                    value.forEach(function (value, idx) {
                        // Carry alias through
                        addRelationshipToStatement(neode, builder, alias, rel_alias + idx, target_alias + idx, relationship, value, aliases, mode);
                    });
                    break;

                // Single Node
                case 'node':
                    addNodeRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases, mode);
                    break;

                // Array of Nodes
                case 'nodes':
                    if (!Array.isArray(value)) value = [value];

                    value.forEach(function (value, idx) {
                        addNodeRelationshipToStatement(neode, builder, alias, rel_alias + idx, target_alias + idx, relationship, value, aliases, mode);
                    });
                    break;
            }
        }
    });

    return builder;
}

/**
 * Add a relationship to the current statement
 *
 * @param {Neode}           neode           Neode instance
 * @param {Builder}         builder         Query builder
 * @param {String}          alias           Current node alias
 * @param {String}          rel_alias       Generated alias for the relationship
 * @param {String}          target_alias    Generated alias for the relationship
 * @param {Relationship}    relationship    Model
 * @param {Object}          value           Value map
 * @param {Array}           aliases         Aliases to carry through in with statement
 * @param {String}          mode        'create' or 'merge'
 */
function addRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases, mode) {
    if (aliases.length > MAX_CREATE_DEPTH) {
        return;
    }

    // Extract Node
    var node_alias = relationship.nodeAlias();
    var node_value = value[node_alias];

    delete value[node_alias];

    // Create Node

    // If Node is passed, attempt to create a relationship to that specific node
    if (node_value instanceof _Node2.default) {
        builder.match(target_alias).whereId(target_alias, node_value.identity());
    }

    // If Primary key is passed then try to match on that
    else if (typeof node_value == 'string' || typeof node_value == 'number') {
            var model = neode.model(relationship.target());

            builder.merge(target_alias, model, _defineProperty({}, model.primaryKey(), node_value));
        }

        // If Map is passed, attempt to create that node and then relate
        else if (Object.keys(node_value).length) {
                var _model = neode.model(relationship.target());

                if (!_model) {
                    throw new Error('Couldn\'t find a target model for ' + relationship.target() + ' in ' + relationship.name() + '.  Did you use module.exports?');
                }

                node_value = _GenerateDefaultValues2.default.async(neode, _model, node_value);

                addNodeToStatement(neode, builder, target_alias, _model, node_value, aliases, mode, _model.mergeFields());
            }

    // Create the Relationship
    builder[mode](alias).relationship(relationship.relationship(), relationship.direction(), rel_alias).to(target_alias);

    // Set Relationship Properties
    relationship.properties().forEach(function (property) {
        var name = property.name();

        if (value.hasOwnProperty(name)) {
            builder.set(rel_alias + '.' + name, value[name]);
        }
    });
}

/**
 * Add a node relationship to the current statement
 *
 * @param {Neode}           neode           Neode instance
 * @param {Builder}         builder         Query builder
 * @param {String}          alias           Current node alias
 * @param {String}          rel_alias       Generated alias for the relationship
 * @param {String}          target_alias    Generated alias for the relationship
 * @param {Relationship}    relationship    Model
 * @param {Object}          value           Value map
 * @param {Array}           aliases         Aliases to carry through in with statement
 * @param {String}  mode        'create' or 'merge'
 */
function addNodeRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases, mode) {
    if (aliases.length > MAX_CREATE_DEPTH) {
        return;
    }

    // If Node is passed, attempt to create a relationship to that specific node
    if (value instanceof _Node2.default) {
        builder.match(target_alias).whereId(target_alias, value.identity());
    }
    // If Primary key is passed then try to match on that
    else if (typeof value == 'string' || typeof value == 'number') {
            var model = neode.model(relationship.target());

            builder.merge(target_alias, model, _defineProperty({}, model.primaryKey(), value));
        }
        // If Map is passed, attempt to create that node and then relate
        // TODO: What happens when we need to validate this?
        // TODO: Is mergeFields() the right option here?
        else if (Object.keys(value).length) {
                var _model2 = neode.model(relationship.target());

                if (!_model2) {
                    throw new Error('Couldn\'t find a target model for ' + relationship.target() + ' in ' + relationship.name() + '.  Did you use module.exports?');
                }

                value = _GenerateDefaultValues2.default.async(neode, _model2, value);

                addNodeToStatement(neode, builder, target_alias, _model2, value, aliases, mode, _model2.mergeFields());
            }

    // Create the Relationship
    builder[mode](alias).relationship(relationship.relationship(), relationship.direction(), rel_alias).to(target_alias);
}