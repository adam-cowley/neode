import GenerateDefaultValues from './GenerateDefaultValues';
import Node from '../Node';
import Validator from './Validator';
import {DIRECTION_IN, DIRECTION_OUT} from '../RelationshipType';

export default function Create(neode, model, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
            // Check we have properties
            if (Object.keys(properties).length == 0) {
                throw new Error('There are no properties set for this Node');
            }

            const labels = model.labels().join(":");
            const origin = 'this';
            const output = [origin];

            const params = {
                __set: {}
            };

            // Add properties to params
            model.properties().forEach((property, key) => {
                // Skip if not set
                if ( !properties.hasOwnProperty( key ) ) {
                    return;
                }

                const value = properties[ key ];

                // Warning: Only set protected properties on creation
                params.__set[ key ] = value;
            });

            // Start Query
            const query = [];
            query.push(`CREATE (${origin}:${labels} {__set})`);

            // Merge relationships
            model.relationships().forEach((relationship, key) => {
                if ( properties.hasOwnProperty( key ) ) {
                    const rels = Array.isArray( properties[ key ] ) ? properties[ key ] : [ properties[ key ] ];

                    // TODO: Set property as key
                    rels.forEach((target, idx) => {
                        const alias = `${relationship.type()}_${idx}`;
                        const direction_in = relationship.direction() == DIRECTION_IN ? '<' : '';
                        const direction_out = relationship.direction() == DIRECTION_OUT ? '>' : '';

                        if ( target instanceof Node ) {
                            query.push(`WITH ${output.join(',')} MATCH (${alias}) WHERE id(${alias}) = {${alias}}`);
                            query.push(`MERGE (${origin})${direction_in}-[:${relationship.relationship()}]-${direction_out}(${alias})`);
                            params[ alias ] = target.idInt();
                        }
                        else if ( target instanceof Object ) {
                            const alias_match = [];
                            Object.keys(target).forEach(key => {
                                const alias_match_key = `${alias}_${key}`;
                                alias_match.push(`${key}:{${alias_match_key}}`);
                                params[ alias_match_key ] = target[ key ];

                            });

                            query.push(`WITH ${output.join(',')} MERGE (${alias} { ${alias_match.join(',')} })`);
                            query.push(`MERGE (${origin})${direction_in}-[:${relationship.relationship()}]-${direction_out}(${alias})`);
                        }
                    });
                }
            });

            query.push(`RETURN ${output.join(', ')}`);

            return neode.cypher(query.join(' '), params)
                .then(res => {
                    return res.records[0].get(origin);
                });
        });
}