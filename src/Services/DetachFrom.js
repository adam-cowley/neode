export default function DetachFrom(neode, from, to) {
    let params = {
        from_id: from.identity(),
        to_id: to.identity(),
    };

    const query = `
        MATCH (from)-[rel]-(to)
        WHERE id(from) = $from_id
        AND id(to) = $to_id
        DELETE rel
    `;

    return neode.writeCypher(query, params)
        .then(() => [from, to]);
}