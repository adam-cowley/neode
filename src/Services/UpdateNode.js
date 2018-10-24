// TODO: Validation?
export default function UpdateNode(neode, model, identity, properties, transaction) {
    const query = `
        MATCH (node) 
        WHERE id(node) = {identity} 
        SET node += {properties} 
        RETURN properties(node) as properties
    `;

    return neode.writeCypher(query, { identity, properties }, transaction)
        .then(res => {
            return res.records[0].get('properties');
        });
}