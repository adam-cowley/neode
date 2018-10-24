// TODO: Validation?
export default function UpdateRelationship(neode, model, identity, properties, transaction) {
    const query = `
        MATCH ()-[rel]->() 
        WHERE id(rel) = {identity} 
        SET rel += {properties} 
        RETURN properties(rel) as properties
    `;

    return neode.writeCypher(query, { identity, properties }, transaction)
        .then(res => {
            return res.records[0].get('properties');
        });
}