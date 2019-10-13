/* eslint-disable no-empty */
import Builder from './Builder';

export const EAGER_ID = '__EAGER_ID__';
export const EAGER_LABELS = '__EAGER_LABELS__';
export const EAGER_TYPE = '__EAGER_TYPE__';
export const MAX_EAGER_DEPTH = 3;


/**
 * Build a pattern to use in an eager load statement
 *
 * @param {Neode} neode                 Neode instance
 * @param {Integer} depth               Maximum depth to stop at
 * @param {String} alias                Alias for the starting node
 * @param {RelationshipType} rel        Type of relationship
 */
export function eagerPattern(neode, depth, alias, rel) {
    const builder = new Builder();

    const name = rel.name();
    const type = rel.type();
    const relationship = rel.relationship();
    const direction = rel.direction();
    const target = rel.target();
    const relationship_variable = `${alias}_${name}_rel`;
    const node_variable = `${alias}_${name}_node`;

    let target_model = undefined;
    try {
        target_model = neode.model( target );
    }
    catch(e) {}

    // Build Pattern
    builder.match(alias)
        .relationship(relationship, direction, relationship_variable)
        .to(node_variable, target_model);


    let fields = node_variable;

    switch ( type ) {
        case 'node':
        case 'nodes':
            fields = eagerNode(neode, depth +1, node_variable, target_model);
            break;

        case 'relationship':
        case 'relationships':
            fields = eagerRelationship(neode, depth + 1, relationship_variable, rel.nodeAlias(), node_variable, target_model);

    }

    const pattern = `${name}: [ ${builder.pattern().trim()} | ${fields} ]`;


    // Get the first?
    if ( type === 'node' || type === 'relationship' ) {
        return pattern + '[0]';
    }

    return pattern;

}

/**
 * Produces a Cypher pattern for a consistant eager loading format for a
 * Node and any subsequent eagerly loaded models up to the maximum depth.
 *
 * @param {Neode} neode     Neode instance
 * @param {Integer} depth   Maximum depth to traverse to
 * @param {String} alias    Alias of the node
 * @param {Model} model     Node model
 */
export function eagerNode(neode, depth, alias, model) {
    const indent = `  `.repeat( depth * 2 );
    let pattern = `\n${indent} ${alias} { `;

    // Properties
    pattern += `\n${indent}${indent}.*`;

    // ID
    pattern += `\n${indent}${indent},${EAGER_ID}: id(${alias})`;

    // Labels
    pattern += `\n${indent}${indent},${EAGER_LABELS}: labels(${alias})`;

    // Eager
    if ( model && depth <= MAX_EAGER_DEPTH ) {
        model.eager().forEach(rel => {
            pattern += `\n${indent}${indent},` + eagerPattern(neode, depth, alias, rel);
        });
    }

    pattern += `\n${indent}}`;

    return pattern;
}

/**
 * Produces a Cypher pattern for a consistant eager loading format for a
 * Relationship and any subsequent eagerly loaded modules up to the maximum depth.
 *
 * @param {Neode} neode     Neode instance
 * @param {Integer} depth   Maximum depth to traverse to
 * @param {String} alias    Alias of the node
 * @param {Model} model     Node model
 */
export function eagerRelationship(neode, depth, alias, node_alias, node_variable, node_model) {
    const indent = `  `.repeat( depth * 2 );
    let pattern = `\n${indent} ${alias} { `;

    // Properties
    pattern += `\n${indent}${indent}.*`;

    // ID
    pattern += `\n${indent}${indent},${EAGER_ID}: id(${alias})`;

    // Type
    pattern += `\n${indent}${indent},${EAGER_TYPE}: type(${alias})`;

    // Node Alias
    // pattern += `\n,${indent}${indent},${node_alias}`
    pattern +=`\n${indent}${indent},${node_alias}: `;
    pattern += eagerNode(neode, depth+1, node_variable, node_model);

    pattern += `\n${indent}}`;

    return pattern;
}