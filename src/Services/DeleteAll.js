// TODO : Delete Dependencies

export default function DeleteAll(neode, model) {
    const query = `MATCH (node:${model.labels().join(':')}) DELETE node`;

    return neode.cypher(query);
}