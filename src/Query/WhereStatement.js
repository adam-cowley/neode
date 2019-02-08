export const CONNECTOR_AND = 'AND';
export const CONNECTOR_OR = 'OR';

export default class WhereStatement {

    constructor(prefix) {
        this._prefix = prefix || '';
        this._clauses = [];
        this._connector = CONNECTOR_AND;
    }

    /**
     * Set the Connector string for chaining statements (AND, OR)
     * 
     * @param {String} connector 
     */
    setConnector(connector) {
        this._connector = connector;
    }

    /**
     * Append a new clause
     *
     * @param  {Where}  clause  Where clause to append
     * @return {WhereStatement}
     */
    append(clause) {
        this._clauses.push(clause);

        return this;
    }

    /** 
     * Return the last condition in the collection
     * 
     * @return {Where}
     */
    last() {
        return this._clauses[ this._clauses.length - 1 ];
    }

    /**
     * Convert this Where Statement to a String
     *
     * @return {String}
     */
    toString() {
        if (!this._clauses.length) return;

        const statements = this._clauses.map(clause => {
            return clause.toString();
        }).join(' '+ this._connector+ ' ');

        return `${this._prefix} (${statements}) `;
    }

}