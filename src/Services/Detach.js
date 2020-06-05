import {
    DIRECTION_IN,
    DIRECTION_OUT
} from '../RelationshipType';

export default function Detach(neode, from, relationship, to) {
    const direction_in = relationship.direction() == DIRECTION_IN ? '<' : '';
    const direction_out = relationship.direction() == DIRECTION_OUT ? '>' : '';
    const type = relationship.relationship();

    let params = {
        from_id: from.identity()
    };
    let matchClause = `MATCH (from)${direction_in}-[rel:${type}]-${direction_out}(to)
                       WHERE id(from) = $from_id`;

    if (to) {
        params.to_id = to.identity();
        matchClause = `${matchClause}
                      AND id(to) = $to_id`;
    }

    const query = `
        ${matchClause}
        DELETE rel
    `;

    return neode.writeCypher(query, params)
        .then(() => {
            return to ? [from, to] : [from];
        });
}