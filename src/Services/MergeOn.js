import GenerateDefaultValues from './GenerateDefaultValues';
import Validator from './Validator';

export default function MergeOn(neode, model, merge_on, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
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
            const query = `MERGE (node:${labels} { ${match.join(', ')} })
            ${Object.keys(params.__on_create_set).length ? 'ON CREATE SET node += {__on_create_set}' : ''}
            ${Object.keys(params.__on_match_set).length ? 'ON MATCH SET node += {__on_match_set}' : ''}
            ${Object.keys(params.__set).length ? 'SET node += {__set}' : ''}
            RETURN node`;

            return neode.cypher(query, params)
                .then(res => {
                    return res.records[0].get('node');
                });
        });
}