export default function DeleteRelationship(neode, identity) {
    const query = `
        MATCH ()-[rel]->() 
        WHERE id(rel) = $identity
        DELETE rel
    `;

    return neode.writeCypher(query, { identity });
}