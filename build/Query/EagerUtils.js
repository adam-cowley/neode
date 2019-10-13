'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MAX_EAGER_DEPTH = exports.EAGER_TYPE = exports.EAGER_LABELS = exports.EAGER_ID = undefined;
exports.eagerPattern = eagerPattern;
exports.eagerNode = eagerNode;
exports.eagerRelationship = eagerRelationship;

var _Builder = require('./Builder');

var _Builder2 = _interopRequireDefault(_Builder);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var EAGER_ID = exports.EAGER_ID = '__EAGER_ID__'; /* eslint-disable no-empty */
var EAGER_LABELS = exports.EAGER_LABELS = '__EAGER_LABELS__';
var EAGER_TYPE = exports.EAGER_TYPE = '__EAGER_TYPE__';
var MAX_EAGER_DEPTH = exports.MAX_EAGER_DEPTH = 3;

/**
 * Build a pattern to use in an eager load statement
 *
 * @param {Neode} neode                 Neode instance
 * @param {Integer} depth               Maximum depth to stop at
 * @param {String} alias                Alias for the starting node
 * @param {RelationshipType} rel        Type of relationship
 */
function eagerPattern(neode, depth, alias, rel) {
    var builder = new _Builder2.default();

    var name = rel.name();
    var type = rel.type();
    var relationship = rel.relationship();
    var direction = rel.direction();
    var target = rel.target();
    var relationship_variable = alias + '_' + name + '_rel';
    var node_variable = alias + '_' + name + '_node';

    var target_model = undefined;
    try {
        target_model = neode.model(target);
    } catch (e) {}

    // Build Pattern
    builder.match(alias).relationship(relationship, direction, relationship_variable).to(node_variable, target_model);

    var fields = node_variable;

    switch (type) {
        case 'node':
        case 'nodes':
            fields = eagerNode(neode, depth + 1, node_variable, target_model);
            break;

        case 'relationship':
        case 'relationships':
            fields = eagerRelationship(neode, depth + 1, relationship_variable, rel.nodeAlias(), node_variable, target_model);

    }

    var pattern = name + ': [ ' + builder.pattern().trim() + ' | ' + fields + ' ]';

    // Get the first?
    if (type === 'node' || type === 'relationship') {
        return pattern + '[0]';
    }

    return pattern;
}

/**
 * Produces a Cypher pattern for a consistant eager loading format for a
 * Node and any subsequent eagerly loaded models up to the maximum depth.
 *
 * @param {Neode} neode     Neode instance
 * @param {Integer} depth   Maximum depth to traverse to
 * @param {String} alias    Alias of the node
 * @param {Model} model     Node model
 */
function eagerNode(neode, depth, alias, model) {
    var indent = '  '.repeat(depth * 2);
    var pattern = '\n' + indent + ' ' + alias + ' { ';

    // Properties
    pattern += '\n' + indent + indent + '.*';

    // ID
    pattern += '\n' + indent + indent + ',' + EAGER_ID + ': id(' + alias + ')';

    // Labels
    pattern += '\n' + indent + indent + ',' + EAGER_LABELS + ': labels(' + alias + ')';

    // Eager
    if (model && depth <= MAX_EAGER_DEPTH) {
        model.eager().forEach(function (rel) {
            pattern += '\n' + indent + indent + ',' + eagerPattern(neode, depth, alias, rel);
        });
    }

    pattern += '\n' + indent + '}';

    return pattern;
}

/**
 * Produces a Cypher pattern for a consistant eager loading format for a
 * Relationship and any subsequent eagerly loaded modules up to the maximum depth.
 *
 * @param {Neode} neode     Neode instance
 * @param {Integer} depth   Maximum depth to traverse to
 * @param {String} alias    Alias of the node
 * @param {Model} model     Node model
 */
function eagerRelationship(neode, depth, alias, node_alias, node_variable, node_model) {
    var indent = '  '.repeat(depth * 2);
    var pattern = '\n' + indent + ' ' + alias + ' { ';

    // Properties
    pattern += '\n' + indent + indent + '.*';

    // ID
    pattern += '\n' + indent + indent + ',' + EAGER_ID + ': id(' + alias + ')';

    // Type
    pattern += '\n' + indent + indent + ',' + EAGER_TYPE + ': type(' + alias + ')';

    // Node Alias
    // pattern += `\n,${indent}${indent},${node_alias}`
    pattern += '\n' + indent + indent + ',' + node_alias + ': ';
    pattern += eagerNode(neode, depth + 1, node_variable, node_model);

    pattern += '\n' + indent + '}';

    return pattern;
}