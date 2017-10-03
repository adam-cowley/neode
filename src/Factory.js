import Node from './Node';
import NodeCollection from './NodeCollection';

export const eager = '__eager_';

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
        return this._neode.models.getByLabels(labels);
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
            const loaded = this.hydrateEager(row);

            definition = definition || this.getDefinition(node.labels);

            return new Node(this._neode, definition, node, loaded);
        });

        return new NodeCollection(this._neode, nodes);
    }

    /**
     * Find all eagerly loaded nodes and add to a NodeCollection
     *
     * @param   row  Neo4j result row
     * @return {Map[String, NodeCollection]}
     */
    hydrateEager(row) {
        const loaded = new Map;
        // Hydrate Eager
        row.keys.forEach(key => {
            if (key.substr(0, eager.length) == eager) {
                const cleaned_key = key.substr(eager.length);

                const collection = new NodeCollection(this._neode, row.get(key).map(node => {
                    return this.make(node);
                }));

                loaded.set(cleaned_key, collection);
            }
        });

        return loaded;
    }

    /**
     * Convert an array of Nodes into a collection
     *
     * @param  {Array}
     * @param  {Definition|null}
     * @return {NodeCollection}
     */
    hydrateAll(nodes, definition) {
        nodes = nodes.map(node => this.make(node, definition));

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

        const row = res.records[0];

        const node = row.get(alias);
        const loaded = this.hydrateEager(row);

        definition = definition || this.getDefinition(node.labels);

        return new Node(this._neode, definition, node, loaded);
    }
}