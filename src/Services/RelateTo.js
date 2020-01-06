import {
    DIRECTION_IN,
    DIRECTION_OUT
} from '../RelationshipType';
import Relationship from '../Relationship';

import GenerateDefaultValues from './GenerateDefaultValues';
import Validator from './Validator';

export default function RelateTo(neode, from, to, relationship, properties, force_create = false) {
    return GenerateDefaultValues(neode, relationship, properties)
        .then(properties => Validator(neode, relationship.schema(), properties))
        .then(properties => {
            const direction_in = relationship.direction() == DIRECTION_IN ? '<' : '';
            const direction_out = relationship.direction() == DIRECTION_OUT ? '>' : '';
            const type = relationship.relationship();

            let params = {
                from_id: from.identity(),
                to_id: to.identity(),
            };
            let set = '';

            if ( Object.keys(properties).length ) {
                set += 'SET ';
                set += Object.keys(properties).map(key => {
                    params[`set_${key}`] = properties[ key ];
                    return `rel.${key} = $set_${key}`;
                }).join(', ');
            }

            const mode = force_create ? 'CREATE' : 'MERGE';

            const query = `
                MATCH (from), (to)
                WHERE id(from) = $from_id
                AND id(to) = $to_id
                ${mode} (from)${direction_in}-[rel:${type}]-${direction_out}(to)
                ${set}
                RETURN rel
            `;

            return neode.writeCypher(query, params)
                .then(res => {
                    const rel = res.records[0].get('rel');
                    const hydrate_from = relationship.direction() == DIRECTION_IN ? to : from;
                    const hydrate_to = relationship.direction() == DIRECTION_IN ? from : to;

                    const properties = new Map;

                    Object.keys(rel.properties).forEach(key => {
                        properties.set( key, rel.properties[ key ] );
                    });

                    return new Relationship(neode, relationship, rel.identity, rel.type, properties, hydrate_from, hydrate_to);
                });
        });
}