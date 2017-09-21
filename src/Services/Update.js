export default function Update(neode, model, node, properties) {
    const query = `MATCH (node) WHERE id(node) = {identity} SET node += {properties} RETURN node`;

    return neode.writeCypher(query, {identity:node.identity, properties})
        .then(res => {
            return res.records[0].get('node');
        });
}