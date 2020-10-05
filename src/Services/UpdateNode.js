import Validator from './Validator';
import CleanValue from './CleanValue';

export default function UpdateNode(neode, model, identity, properties) {
    const query = `
        MATCH (node)
        WHERE id(node) = $identity
        SET node += $properties
        WITH node

        UNWIND keys($properties) AS key
        RETURN key, node[key] AS value
    `;

    // Clean up values
    const schema = model.schema();

    Object.keys(schema).forEach(key => {
        const config = typeof schema[ key ] == 'string' ? {type: schema[ key ]} : schema[ key ];

        // Clean Value
        if (properties[ key ]) {
            properties[ key ] = CleanValue(config, properties[ key ]);
        }
    });

    return Validator(neode, model, properties)
        .then(properties => {
            return neode.writeCypher(query, { identity, properties })
                .then(res => {
                    return res.records.map(row => ({ key: row.get('key'), value: row.get('value') }))
                });
        });
}