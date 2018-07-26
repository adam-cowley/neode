'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = Delete;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _Factory = require('../Factory');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function Delete(neode, identity, model) {
    var alias = 'this';
    var to_delete = [];
    var detach_delete = [alias];

    var builder = new _Builder2.default(neode).match(alias, model).whereId(alias, identity);

    // Cascade delete to relationships
    model.eager().forEach(function (relationship) {
        var cascade = relationship.cascade();
        if (cascade) {
            var node_key = '' + _Factory.eager + relationship.type();
            var rel_key = _Factory.eager + '_rel_' + relationship.type();

            builder.optionalMatch(alias).relationship(relationship.relationship(), relationship.direction(), rel_key).to(node_key, relationship.target());

            switch (cascade) {
                case 'delete':
                    detach_delete.push(node_key);
                    break;
                case 'detach':
                    to_delete.push(node_key);
                    break;
            }
        }
    });

    // Delete Nodes & Rels
    if (to_delete.length) {
        builder.delete(to_delete);
    }

    // Detach Delete Nodes & Rels
    if (detach_delete.length) {
        builder.detachDelete(detach_delete);
    }

    return builder.execute(_Builder.mode.WRITE);
}