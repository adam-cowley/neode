import Collection from './Collection';
import Node from './Node';
import Relationship from './Relationship';
import neo4j from 'neo4j-driver';

import { EAGER_ID, EAGER_LABELS, EAGER_TYPE, } from './Query/EagerUtils';
import { DIRECTION_IN, } from './RelationshipType';

export default class Factory {

    /**
     * @constuctor
     *
     * @param Neode neode
     */
    constructor(neode) {
        this._neode = neode;
        this._objectsById = [];
        this._objectsAliases = [];
        this._objectsResult = [];
    }

    /**
     * Hydrate all nodes and relations from a result set, return first result
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck first
     * @return {Node}
     */
    hydrateResult(res, alias) {
        const results = this.hydrateResults(res, alias);

        if (results.length > 0) {
            return results[0];
        }

        return null;
    }

    /**
     * Hydrate all nodes and relations from a result set, based on schema
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck first
     * @return {Node}
     */
    hydrateResults(res, alias) {
        this._objectsById = [];
        this._objectsAliases = [];
        this._objectsResult = [];

        res.records.forEach((record) => {
            this._visitedAliases = [];
            this.hydrateRecord(record, alias);
            this.hydrateRecordEagers(record, alias);
        });

        return this._objectsResult;
    }

    /**
     * Hydrate nodes and relations from a record result, based on schema
     *
     * @param  {Object} record Neo4j Result Line
     * @param  {String} alias  Alias of Node to pluck first
     * @return {Node}
     */
    hydrateRecord(record, alias) {
        record.keys.forEach((key) => {
            const node = record.get(key);

            if (node !== undefined && (node.constructor.name == "Node")) {
                if (this._objectsById[node.identity.toNumber()] !== undefined) {
                    return;
                }

                const entity = this.hydrateNode(node);
                this._objectsById[node.identity.toNumber()] = entity;
                this._objectsAliases[node.identity.toNumber()] = key;

                if (key == alias) {
                    this._objectsResult.push(entity);
                }
            }
        });
    }

    /**
     * Hydrate nodes and relations from a record result, based on schema
     *
     * @param  {Object} record Neo4j Result Line
     * @param  {String} alias  Alias of reference Node
     * @return {Node}
     */
    hydrateRecordEagers(record, alias) {
        record.keys.forEach((key) => {
            const relation = record.get(key);

            if (relation === undefined || (relation.constructor.name !== "Relationship")) {
                return;
            }

            if (this._objectsById[relation.identity.toNumber()] !== undefined) {
                return;
            }

            let referenceNode = null;
            let otherNode = null;
            if (record.get(alias).identity.toNumber() == relation.start.toNumber()) {
                referenceNode = this._objectsById[relation.start.toNumber()];
                otherNode = this._objectsById[relation.end.toNumber()];
            } else if (record.get(alias).identity.toNumber() == relation.end.toNumber()) {
                referenceNode = this._objectsById[relation.end.toNumber()];
                otherNode = this._objectsById[relation.start.toNumber()];
            } else {
                return;
            }

            const definition = this.getDefinition(null, referenceNode.labels())
            definition.eager().forEach(eager => {
                if (relation.type != eager.relationship()) {
                    return;
                }

                if (otherNode.labels().indexOf(eager.target()) == -1) {
                    return;
                }

                let refEager = null;
                const name = eager.name();

                switch (eager.type()) {
                    case 'node':
                        referenceNode.setEager(name, otherNode);
                        break;

                    case 'nodes':
                        refEager = referenceNode.getEager(name);
                        if (refEager === undefined) {
                            refEager = new Collection(this._neode);
                            referenceNode.setEager(name, refEager);
                        }

                        refEager.add(otherNode);
                        break;

                    case 'relationship':
                        referenceNode.setEager(name, this.hydrateRelationship(eager, relation, referenceNode));
                        break;

                    case 'relationships':
                        refEager = referenceNode.getEager(name);
                        if (refEager === undefined) {
                            refEager = new Collection(this._neode);
                            referenceNode.setEager(name, refEager);
                        }

                        refEager.add(this.hydrateRelationship(eager, relation, referenceNode));
                        break;
                }
            });

            this._objectsById[relation.identity.toNumber()] = relation;
            this._visitedAliases.push(alias);

            const otherAlias = this._objectsAliases[otherNode.id()];
            if (this._visitedAliases.indexOf(otherAlias) == -1) {
                this.hydrateRecordEagers(record, otherAlias);
            }
        });
    }

    /**
     * Hydrate the first record in a result set
     *
     * @param  {Object} res    Neo4j Result
     * @param  {String} alias  Alias of Node to pluck
     * @return {Node}
     */
    hydrateFirst(res, alias, definition) {
        if ( !res || !res.records.length ) {
            return false;
        }

        return this.hydrateNode( res.records[0].get(alias), definition );
    }

    /**
     * Hydrate a set of nodes and return a Collection
     *
     * @param  {Object}          res            Neo4j result set
     * @param  {String}          alias          Alias of node to pluck
     * @param  {Definition|null} definition     Force Definition
     * @return {Collection}
     */

    hydrate(res, alias, definition) {
        if ( !res ) {
            return false;
        }

        const nodes = res.records.map( row => this.hydrateNode(row.get(alias), definition) );

        return new Collection(this._neode, nodes);
    }

    /**
     * Get the definition by a set of labels
     *
     * @param  {Array} labels
     * @return {Model}
     */
    getDefinition(definition, labels) {
        // Get Definition from
        if ( !definition ) {
            definition = this._neode.models.getByLabels(labels);
        }
        else if ( typeof definition === 'string' ) {
            definition = this._neode.models.get(definition);
        }

        // Helpful error message if nothing could be found
        if ( !definition ) {
            throw new Error(`No model definition found for labels ${ JSON.stringify(labels) }`);
        }

        return definition;
    }

    /**
     * Take a result object and convert it into a Model
     *
     * @param {Object}              record
     * @param {Model|String|null}   definition
     * @return {Node}
     */
    hydrateNode(record, definition) {
        // Is there no better way to check this?!
        if ( neo4j.isInt( record.identity ) && Array.isArray( record.labels ) ) {
            record = Object.assign({}, record.properties, {
                [EAGER_ID]: record.identity,
                [EAGER_LABELS]: record.labels,
            });
        }

        // Get Internals
        const identity = record[ EAGER_ID ];
        const labels = record[ EAGER_LABELS ];

        // Get Definition
        definition = this.getDefinition(definition, labels);

        // Get Properties
        const properties = new Map;

        definition.properties().forEach((value, key) => {
            if ( record.hasOwnProperty(key) ) {
                properties.set(key, record[ key ]);
            }
        });

        // Create Node Instance
        const node = new Node(this._neode, definition, identity, labels, properties);

        // Add eagerly loaded props
        definition.eager().forEach(eager => {
            const name = eager.name();

            if ( !record[ name ] ) {
                return;
            }

            switch ( eager.type() ) {
                case 'node':
                    node.setEager(name, this.hydrateNode(record[ name ]) );
                    break;

                case 'nodes':
                    node.setEager( name, new Collection(this._neode, record[ name ].map(value => this.hydrateNode(value))) );
                    break;

                case 'relationship':
                    node.setEager( name, this.hydrateRelationship(eager, record[ name ], node) );
                    break;

                case 'relationships':
                    node.setEager( name, new Collection(this._neode, record[ name ].map(value => this.hydrateRelationship(eager, value, node))) );
                    break;
            }
        });

        return node;
    }

    /**
     * Take a result object and convert it into a Relationship
     *
     * @param  {RelationshipType}  definition  Relationship type
     * @param  {Object}            record      Record object
     * @param  {Node}              this_node   'This' node in the current  context
     * @return {Relationship}
     */
    hydrateRelationship(definition, record, this_node) {
        // Get Internals
        const identity = record[ EAGER_ID ];
        const type = record[ EAGER_TYPE ];

        // Get Properties
        const properties = new Map;

        definition.properties().forEach((value, key) => {
            if ( record.hasOwnProperty(key) ) {
                properties.set(key, record[ key ]);
            }
        });

        // Start & End Nodes
        const other_node = this.hydrateNode( record[ definition.nodeAlias() ] );

        // Calculate Start & End Nodes
        const start_node = definition.direction() == DIRECTION_IN
            ? other_node: this_node;

        const end_node = definition.direction() == DIRECTION_IN
            ? this_node : other_node;

        return new Relationship(this._neode, definition, identity, type, properties, start_node, end_node);
    }

}
