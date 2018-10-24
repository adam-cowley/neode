export default function DeleteRelationship(neode, identity, transaction) {
    const query = `
        MATCH ()-[rel]->() 
        WHERE id(rel) = {identity} 
        DELETE rel
    `;

    return neode.writeCypher(query, { identity }, transaction);
}