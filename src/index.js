import neo4j from 'neo4j-driver';
import Model from './Model';
import Node from './Node';

export default class Neode {

    /**
     * Constructor
     *
     * @param  {String} connection_string
     * @param  {String} username
     * @param  {String} password
     * @return {Neode}
     */
    constructor(connection_string, username, password) {
        const auth = username && password ? neo4j.auth.basic(username, password) : null;
        this.driver = new neo4j.driver(connection_string, auth);

        this.models = new Map();
    }

    /**
     * Define a new Model
     *
     * @param  {String} name
     * @param  {Object} schema
     * @return {Model}
     */
    model(name, schema) {
        if ( schema instanceof Object) {
            const model = new Model(this, name, schema);
            this.models.set(name, model);
        }

        return this.models.get(name);
    }


    /**
     * Create a new Node of a type
     *
     * @param  {String} model
     * @param  {Object} properties
     * @return {Node}
     */
    create(model, properties) {
        return this.get(model).create(properties);
    }

    /**
     * Delete a Node from the graph
     *
     * @param  {Node} node
     * @return {void}
     */
    delete(node) {
        return node.delete();
    }

    /**
     * Run a Cypher query
     *
     * @param  {String} query
     * @param  {Object} params
     * @return {Promise}
     */
    cypher(query, params) {
        const session = this.driver.session();

        return session.run(query, params)
            .then(res => {
                session.close();

                return res;
            })
            .catch(err => {
                session.close();

                throw err;
            });
    }

    /**
     * Close Driver
     *
     * @return {void}
     */
    close() {
        this.driver.close();
    }

}

export {
    Model,
    Node
};
