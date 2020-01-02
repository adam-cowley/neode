import Validator from './Validator';

export default function UpdateNode(neode, model, identity, properties) {
    const query = `
        MATCH (node)
        WHERE id(node) = $identity
        SET node += $properties
        RETURN properties(node) as properties
    `;

    return Validator(neode, model, properties)
        .then(properties => {
            return neode.writeCypher(query, { identity, properties })
                .then(res => {
                    return res.records[0].get('properties');
                });
        });
}