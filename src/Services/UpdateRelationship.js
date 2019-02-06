import Validator from './Validator';

export default function UpdateRelationship(neode, model, identity, properties) {
    const query = `
        MATCH ()-[rel]->() 
        WHERE id(rel) = {identity} 
        SET rel += {properties} 
        RETURN properties(rel) as properties
    `;

    return Validator(neode, model, properties)
        .then(properties => {
            return neode.writeCypher(query, { identity, properties })
                .then(res => {
                    return res.records[0].get('properties');
                });
        });
}
