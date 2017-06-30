export default function Delete(neode, node) {
    const query = `MATCH (node) WHERE id(node) = {identity} DETACH DELETE node`;

    return neode.cypher(query, {identity:node.identity});
}