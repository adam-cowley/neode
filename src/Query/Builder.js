import Match from './Match';
import Return from './Return';
import Statement from './Statement';
import WhereStatement from './WhereStatement';
import Where, {OPERATOR_EQUALS} from './Where';
import WhereId from './WhereId';
import WhereRaw from './WhereRaw';
import WithStatement from './WithStatement';


export default class Builder {

    constructor(neode) {
        this._neode = neode;

        this._params = {};
        this._statements = [];
        this._current;
        this._where;
    }

    /**
     * Start a new Query segment and set the current statement
     *
     * @return {Builder}
     */
    statement() {
        if (this._current) {
            this._statements.push(this._current);
        }

        this._current = new Statement();

        return this;
    }

    /**
     * Start a new Where Segment
     *
     * @return {Builder}
     */
    whereStatement(prefix) {
        if (this._where) {
            this._current.where(this._where);
        }

        this._where = new WhereStatement(prefix);

        return this;
    }

    /**
     * Match a Node by a definition
     *
     * @param  {String} alias      Alias in query
     * @param  {Model}  model      Model definition
     * @return {Builder}           Builder
     */
    match(alias, model) {
        this.whereStatement('WHERE');
        this.statement();

        this._current.match(new Match(alias, model));

        return this;
    }

    /**
     * Add a 'with' statement to the query
     *
     * @param  {...String} args Variables/aliases to return
     * @return {Builder}
     */
    with(...args) {
        this.whereStatement('WHERE');
        this.statement();

        this._statements.push(new WithStatement(...args));

        return this;
    }

    /**
     * Create a new WhereSegment
     * @param  {...mixed} args
     * @return {Builder}
     */
    or(...args) {
        this.whereStatement('OR');

        return this.where(...args);
    }

    /**
     * Add a where condition to the current statement.
     *
     * @param  {...mixed} args Argumenta
     * @return {Builder}         [description]
     */
    where(...args) {
        // If 2 character length, it should be straight forward where
        if (args.length == 2) {
            args = [args[0], OPERATOR_EQUALS, args[1]];
        }

        // If only one argument, treat it as a single string
        if ( args.length == 1 ) {
            this._where.append(new WhereRaw(args[0]));
        }
        else {
            const [left, operator, value] = args;
            const right = `where_${left}`.replace(/([^a-z0-9_]+)/i, '_');

            this._params[ right ] = value;
            this._where.append(new Where(left, operator, `{${right}}`));
        }

        return this;
    }

    /**
     * Query on Internal ID
     *
     * @param  {String} alias
     * @param  {Int}    value
     * @return {Builder}       [description]
     */
    whereId(alias, value) {
        const param = `where_id_${alias}`;

        this._params[ param ] = value;

        this._where.append(new WhereId(alias, param));

        return this;
    }

    /**
     * Set Return fields
     *
     * @param  {...mixed} args
     * @return {Builder}
     */
    return(...args) {
        this._current.return(...args);

        return this;
    }

    /**
     * Set Record Limit
     *
     * @param  {Int} limit
     * @return {Builder}
     */
    limit(limit) {
        this._current.limit(limit);

        return this;
    }

    /**
     * Set Records to Skip
     *
     * @param  {Int} skip
     * @return {Builder}
     */
    skip(skip) {
        this._current.skip(skip);

        return this;
    }

    /**
     * Build the Query
     *
     * @param  {...String} output References to output
     * @return {Object}           Object containing `query` and `params` property
     */
    build() {
        // Append Statement to Statements
        this.whereStatement();
        this.statement();

        const query = this._statements.map(statement => {
            return statement.toString();
        }).join('\n');

        return {
            query,
            params: this._params
        };
    }

    /**
     * Execute the query
     *
     * @return {Promise}
     */
    execute() {
        const {query, params} = this.build();

        return this._neode.cypher(query, params);
    }



}