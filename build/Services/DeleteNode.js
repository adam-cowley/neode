'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MAX_EAGER_DEPTH = undefined;
exports.default = DeleteNode;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var MAX_EAGER_DEPTH = exports.MAX_EAGER_DEPTH = 10;

/**
 * Add a recursive cascade deletion
 *
 * @param {Neode}            neode          Neode instance
 * @param {Builder}          builder        Query Builder
 * @param {String}           alias          Alias of node
 * @param {RelationshipType} relationship   relationship type definition
 * @param {Array}            aliases        Current aliases
 * @param {Integer}          to_depth       Maximum depth to delete to
 */
function addCascadeDeleteNode(neode, builder, from_alias, relationship, aliases, to_depth) {
    if (aliases.length > to_depth) return;

    var rel_alias = from_alias + relationship.name() + '_rel';
    var node_alias = from_alias + relationship.name() + '_node';
    var target = neode.model(relationship.target());

    // Optional Match
    builder.optionalMatch(from_alias).relationship(relationship.relationship(), relationship.direction(), rel_alias).to(node_alias, relationship.target());

    // Check for cascade deletions
    target.relationships().forEach(function (relationship) {
        switch (relationship.cascade()) {
            case 'delete':
                addCascadeDeleteNode(neode, builder, node_alias, relationship, aliases.concat(node_alias), to_depth);
                break;

            // case 'detach':
            //     addDetachNode(neode, builder, node_alias, relationship, aliases);
            //     break;
        }
    });

    // Delete it
    builder.detachDelete(node_alias);
}

/**
 * Delete the relationship to the other node
 *
 * @param {Neode}            neode          Neode instance
 * @param {Builder}          builder        Query Builder
 * @param {String}           from_alias     Alias of node at start of the match
 * @param {RelationshipType} relationship   model definition
 * @param {Array}            aliases        Current aliases
 * /
function addDetachNode(neode, builder, from_alias, relationship, aliases) {
    // builder.withDistinct(aliases);

    const rel_alias = from_alias + relationship.name() + '_rel';

    builder.optionalMatch(from_alias)
        .relationship(relationship.relationship(), relationship.direction(), rel_alias)
        .toAnything()
        .delete(rel_alias);

    // builder.withDistinct( aliases );
}
 */

/**
 * Cascade Delete a Node
 *
 * @param {Neode}   neode       Neode instance
 * @param {Integer} identity    Neo4j internal ID of node to delete
 * @param {Model}   model       Model definition
 * @param {Integer} to_depth    Maximum deletion depth
 */
function DeleteNode(neode, identity, model) {
    var to_depth = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : MAX_EAGER_DEPTH;

    var alias = 'this';
    // const to_delete = [];
    var aliases = [alias];
    // const depth = 1;

    var builder = new _Builder2.default(neode).match(alias, model).whereId(alias, identity);

    // Cascade delete to relationships
    model.relationships().forEach(function (relationship) {
        switch (relationship.cascade()) {
            case 'delete':
                addCascadeDeleteNode(neode, builder, alias, relationship, aliases, to_depth);
                break;

            // case 'detach':
            //     addDetachNode(neode, builder, alias, relationship, aliases);
            //     break;
        }
    });

    // Detach Delete target node
    builder.detachDelete(alias);

    return builder.execute(_Builder.mode.WRITE);
}