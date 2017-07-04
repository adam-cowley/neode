export const CONNECTOR_AND = 'AND';
export const CONNECTOR_OR = 'OR';

export default class WhereStatement {

    constructor(prefix) {
        this._prefix = prefix || '';
        this._clauses = [];
        this._connector = CONNECTOR_AND;
    }

    /**
     * [setConnector description]
     * @param {[type]} connector [description]
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