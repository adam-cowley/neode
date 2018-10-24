// TODO : Delete Dependencies

export default function DeleteAll(neode, model, transaction) {
    const query = `MATCH (node:${model.labels().join(':')}) DETACH DELETE node`;

    return neode.writeCypher(query, transaction);
}