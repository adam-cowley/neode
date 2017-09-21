import GenerateDefaultValues from './GenerateDefaultValues';
import Node from '../Node';
import Validator from './Validator';
import {DIRECTION_IN, DIRECTION_OUT} from '../RelationshipType';

export default function MergeOn(neode, model, merge_on, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
            const tx = neode.transaction();
            const match = [];

            let params = {
                __set: {},
                __on_match_set: {},
                __on_create_set: {}
            };

            // Check we have properties
            if (Object.keys(properties).length == 0) {
                throw new Error('There are no properties set for this Node');
            }

            // Convert string merge on
            if ( !Array.isArray(merge_on) ) {
                merge_on = [merge_on];
            }

            // Get Match Properties
            merge_on.forEach(key => {
                if ( properties.hasOwnProperty( key ) ) {
                    match.push(`${key}: {match_${key}}`);
                    params[ `match_${key}`] = properties[ key ];
                }
            });

            // Throw error if no merge fields are present
            if ( !match.length ) {
                throw new Error('No merge properties have been supplied');
            }

            // Add properties to params
            model.properties().forEach((property, key) => {
                // Skip if not set
                if ( !properties.hasOwnProperty( key ) ) {
                    return;
                }

                const value = properties[ key ];

                // Only set protected properties on creation
                if ( property.protected() ) {
                    params.__on_create_set[ key ] = value;
                }
                else {
                    params.__set[ key ] = value;
                }
            });

            const labels = model.labels().join(":");
            const origin = 'this';
            const query = [];
            const output = [origin];

            query.push(`MERGE (${origin}:${labels} { ${match.join(', ')} })`);

            // Set Properties
            Object.keys(params.__on_create_set).length && query.push(`ON CREATE SET ${origin} += {__on_create_set}`);
            Object.keys(params.__on_match_set).length && query.push(`ON MATCH SET ${origin} += {__on_match_set}`);
            Object.keys(params.__set).length && query.push(`SET ${origin} += {__set}`);

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

            // Output
            query.push(`RETURN ${output.join()}`);

            return neode.writeCypher(query.join(' '), params)
                .then(res => {
                    tx.success();

                    return res.records[0].get(origin);
                });
        });
}