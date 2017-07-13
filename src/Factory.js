import Node from './Node';
import NodeCollection from './NodeCollection';

export default class Factory {

    /**
     * @constuctor
     * 
     * @param Neode neode
     */
    constructor(neode) {
        this._neode = neode;
    }

    /**
     * Turn a result node into a 
     * 
     * @param  {Object} node    Neo4j Node
     * @return {Node|false}
     */
    make(node) {
        const labels = node.labels;
        const definition = this.getDefinition(labels);

        return new Node(this._neode, definition, node);
    }

    /**
     * Get the definition for a set of labels
     * 
     * @param  {Array} labels
     * @return {Definition}
     */
    getDefinition(labels) {
        if ( !Array.isArray(labels) ) {
            labels = [ labels ];
        }

        for (let entry of this._neode.models) {
            const [ name, definition ] = entry; // eslint-disable-line no-unused-vars

            if ( definition.labels().join(':') == labels.join(':') ) {
                return definition;
            }
        }

        return false;
    }

    /**
     * Hydrate a set of nodes and return a NodeCollection
     *
     * @param  {Object}          res            Neo4j result set
     * @param  {String}          alias          Alias of node to pluck
     * @param  {Definition|null} definition     Force Definition
     * @return {NodeCollection}
     */
    hydrate(res, alias, definition) {
        const nodes = res.records.map(row => {
            const node = row.get(alias);

            definition = definition || this.getDefinition(node.labels);

            return new Node(this._neode, definition, node);
        });

        return new NodeCollection(this._neode, nodes);
    }

    /**
     * Hydrate the first record in a result set
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck
     * @return {Node}
     */
    hydrateFirst(res, alias, definition) {
        if (!res.records.length) {
            return false;
        }

        const node = res.records[0].get(alias);

        definition = definition || this.getDefinition(node.labels);

        return new Node(this._neode, definition, node);
    }
}