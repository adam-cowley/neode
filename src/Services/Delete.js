import Builder, {mode} from '../Query/Builder';
import {eager} from '../Factory';

export default function Delete(neode, node, model) {
    const alias = 'this';
    const to_delete = [];
    const detach_delete = [alias];

    const builder = (new Builder(neode))
        .match(alias, model)
        .whereId(alias, node.identity);

    // Cascade delete to relationships
    model.eager().forEach(relationship => {
        const cascade = relationship.cascade();
        if ( cascade ) {
            const node_key = `${eager}${relationship.type()}`;
            const rel_key = `${eager}_rel_${relationship.type()}`;

            builder.optionalMatch(alias)
                .relationship(relationship.relationship(), relationship.direction(), rel_key)
                .to(node_key, relationship.target());

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
    if ( to_delete.length ) {
        builder.delete(to_delete);
    }

    // Detach Delete Nodes & Rels
    if ( detach_delete.length ) {
        builder.detachDelete(detach_delete);
    }

    return builder.execute(mode.WRITE);
}