import Match from './Match';
import Order from './Order';
// import Return from './Return';
import Statement from './Statement';
import Property from './Property';
import WhereStatement from './WhereStatement';
import Where, {OPERATOR_EQUALS} from './Where';
import WhereBetween from './WhereBetween';
import WhereId from './WhereId';
import WhereRaw from './WhereRaw';
import WithStatement from './WithStatement';
import WithDistinctStatement from './WithDistinctStatement';
import neo4j from 'neo4j-driver';

export const mode = {
    READ: "READ",
    WRITE: "WRITE"
};


export default class Builder {

    constructor(neode) {
        this._neode = neode;

        this._params = {};
        this._statements = [];
        this._current;
        this._where;
        this._set_count = 0;
    }

    /**
     * Start a new Query segment and set the current statement
     *
     * @return {Builder}
     */
    statement(prefix) {
        if (this._current) {
            this._statements.push(this._current);
        }

        this._current = new Statement(prefix);

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
     * @param  {String} alias           Alias in query
     * @param  {Model|String}  model    Model definition
     * @param  {Object|null}   properties   Inline Properties
     * @return {Builder}                Builder
     */
    match(alias, model, properties) {
        this.whereStatement('WHERE');
        this.statement();

        this._current.match( new Match(alias, model, this._convertPropertyMap( alias, properties ) ) );

        return this;
    }

    optionalMatch(alias, model) {
        this.whereStatement('WHERE');
        this.statement('OPTIONAL MATCH');

        this._current.match(new Match(alias, model));

        return this;
    }

    /**
     * Add a 'with' statement to the query
     *
     * @param  {...String} args Variables/aliases to carry through
     * @return {Builder}
     */
    with(...args) {
        this.whereStatement('WHERE');
        this.statement();

        this._statements.push(new WithStatement(...args));

        return this;
    }

    /**
     * Add a 'with distinct' statement to the query
     *
     * @param  {...String} args Variables/aliases to carry through
     * @return {Builder}
     */
    withDistinct(...args) {
        this.whereStatement('WHERE');
        this.statement();

        this._statements.push(new WithDistinctStatement(...args));

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
     * Generate a unique key and add the value to the params object
     * 
     * @param {String} key 
     * @param {Mixed} value 
     */
    _addWhereParameter(key, value) {
        let attempt = 1;
        let base = `where_${key.replace(/[^a-z0-9]+/, '_')}`;

        // Try to create a unique key
        let variable = base;

        while ( typeof this._params[ variable ] != "undefined" ) {
            attempt++;

            variable = `${base}_${attempt}`;
        }

        this._params[ variable ] = value;

        return variable;
    }

    /**
     * Add a where condition to the current statement.
     *
     * @param  {...mixed} args Arguments
     * @return {Builder}         
     */
    where(...args) {
        if (!args.length || !args[0]) return this;

        // If 2 character length, it should be straight forward where
        if (args.length == 2) {
            args = [args[0], OPERATOR_EQUALS, args[1]];
        }

        // If only one argument, treat it as a single string
        if ( args.length == 1) {
            const [arg] = args;

            if (Array.isArray(arg)) {
                arg.forEach(inner => {
                    this.where(...inner);
                });
            }
            else if (typeof arg == 'object') {
                Object.keys(arg).forEach(key => {
                    this.where(key, arg[key]);
                });
            }
            else {
                this._where.append(new WhereRaw(args[0]));
            }
        }
        else {
            const [left, operator, value] = args;
            const right = this._addWhereParameter(left, value);

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
     * @return {Builder}       
     */
    whereId(alias, value) {
        const param = this._addWhereParameter(`${alias}_id`, neo4j.int(value));

        this._where.append(new WhereId(alias, param));

        return this;
    }

    /**
     * Add a raw where clause
     *
     * @param  {String} clause
     * @return {Builder}       
     */
    whereRaw(clause) {
        this._where.append(new WhereRaw(clause));

        return this;
    }

    /**
     * A negative where clause
     * 
     * @param {*} args 
     * @return {Builder}       
     */
    whereNot(...args) {
        this.where(...args);

        this._where.last().setNegative();

        return this;
    }

    /**
     * Between clause
     * 
     * @param {String} alias 
     * @param {Mixed} floor 
     * @param {Mixed} ceiling 
     * @return {Builder}
     */
    whereBetween(alias, floor, ceiling) {
        const floor_alias = this._addWhereParameter(`${alias}_floor`, floor);
        const ceiling_alias = this._addWhereParameter(`${alias}_ceiling`, ceiling);

        this._where.append(new WhereBetween(alias, floor_alias, ceiling_alias));

        return this;
    }

    /**
     * Negative Between clause
     * 
     * @param {String} alias 
     * @param {Mixed} floor 
     * @param {Mixed} ceiling 
     * @return {Builder}
     */
    whereNotBetween(alias, floor, ceiling) {
        this.whereBetween(alias, floor, ceiling);

        this._where.last().setNegative();

        return this;
    }

    /**
     * Set Delete fields
     *
     * @param  {...mixed} args
     * @return {Builder}
     */
    delete(...args) {
        this._current.delete(...args);

        return this;
    }

    /**
     * Set Detach Delete fields
     *
     * @param  {...mixed} args
     * @return {Builder}
     */
    detachDelete(...args) {
        this._current.detachDelete(...args);

        return this;
    }

    /**
     * Start a Create Statement by alias/definition
     *
     * @param  {String} alias               Alias in query
     * @param  {Model|String}  model        Model definition
     * @param  {Object|null}   properties   Inline Properties
     * @return {Builder}                    Builder
     */
    create(alias, model, properties) {
        this.whereStatement('WHERE');
        this.statement('CREATE');

        this._current.match( new Match(alias, model, this._convertPropertyMap( alias, properties ) ) );

        return this;
    }

    /**
     * Convert a map of properties into an Array of 
     * 
     * @param {Object|null} properties 
     */
    _convertPropertyMap(alias, properties) {
        if ( properties ) {
            return Object.keys(properties).map(key => {
                const property_alias = `${alias}_${key}`;

                this._params[ property_alias ] = properties[ key ];

                return new Property( key, property_alias );
            });
        }

        return [];
    }

    /**
     * Start a Merge Statement by alias/definition
     *
     * @param  {String}        alias        Alias in query
     * @param  {Model|String}  model        Model definition
     * @param  {Object|null}   properties   Inline Properties
     * @return {Builder}                    Builder
     */
    merge(alias, model, properties) {
        this.whereStatement('WHERE');
        this.statement('MERGE');

        this._current.match( new Match(alias, model, this._convertPropertyMap( alias, properties ) ) );

        return this;
    }

    /**
     * Set a property
     * 
     * @param {String|Object} property   Property in {alias}.{property} format
     * @param {Mixed}         value      Value
     * @param {String}        operator   Operator
     */
    set(property, value, operator = '=') {
        // Support a map of properties
        if ( !value && property instanceof Object ) {
            Object.keys(property).forEach(key => {
                this.set(key, property[ key ]);
            });
        }
        else {
            if (value) {
                const alias = `set_${this._set_count}`;
                this._params[ alias ] = value;
                
                this._set_count++;
                
                this._current.set(property, alias, operator);
            } else {
                this._current.setRaw(property);
            }
        }

        return this;
    }


    /**
     * Set a property
     * 
     * @param {String|Object} property   Property in {alias}.{property} format
     * @param {Mixed}         value      Value
     * @param {String}        operator   Operator
     */
    onCreateSet(property, value, operator = '=') {
        // Support a map of properties
        if ( !value && property instanceof Object ) {
            Object.keys(property).forEach(key => {
                this.onCreateSet(key, property[ key ]);
            });
        }
        else {
            const alias = `set_${this._set_count}`;
            this._params[ alias ] = value;

            this._set_count++;

            this._current.onCreateSet(property, alias, operator);
        }

        return this;
    }


    /**
     * Set a property
     * 
     * @param {String|Object} property   Property in {alias}.{property} format
     * @param {Mixed}         value      Value
     * @param {String}        operator   Operator
     */
    onMatchSet(property, value, operator = '=') {
        // Support a map of properties
        if ( !value && property instanceof Object ) {
            Object.keys(property).forEach(key => {
                this.onMatchSet(key, property[ key ]);
            });
        }
        else {
            const alias = `set_${this._set_count}`;
            this._params[ alias ] = value;

            this._set_count++;

            this._current.onMatchSet(property, alias, operator);
        }

        return this;
    }

    /**
     * Remove properties or labels in {alias}.{property} 
     * or {alias}:{Label} format
     * 
     * @param {[String]} items 
     */
    remove(...items) {
        this._current.remove(items);

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
     * Add an order by statement
     *
     * @param  {...String|object} args  Order by statements
     * @return {Builder}
     */
    orderBy(...args) {
        let order_by;

        if (args.length == 2) {
            // Assume orderBy(what, how)
            order_by = new Order(args[0], args[1]);

        }
        else if (Array.isArray(args[0])) {
            // Handle array of where's
            args[0].forEach(arg => {
                this.orderBy(arg);
            });
        }
        // TODO: Ugly, stop supporting this
        else if (typeof args[0] == 'object' && args[0].field) {
            // Assume orderBy(args[0].field, args[0].order)
            order_by = new Order(args[0].field, args[0].order);
        }
        else if (typeof args[0] == 'object') {
            // Assume {key: order}
            Object.keys(args[0]).forEach(key => {
                this.orderBy(key, args[0][key]);
            });
        }
        else if (args[0]) {
            // Assume orderBy(what, 'ASC')
            order_by = new Order(args[0]);
        }

        if (order_by) {
            this._current.order(order_by);
        }

        return this;
    }

    /**
     * Add a relationship to the query
     *
     * @param  {String|RelationshipType} relationship  Relationship name or RelationshipType object
     * @param  {String}                  direction     Direction of relationship DIRECTION_IN, DIRECTION_OUT
     * @param  {String|null}             alias         Relationship alias
     * @param  {Int|String}              degrees        Number of traversdegreesals (1, "1..2", "0..2", "..3")
     * @return {Builder}
     */
    relationship(relationship, direction, alias, degrees) {
        this._current.relationship(relationship, direction, alias, degrees);

        return this;
    }

    /**
     * Complete a relationship
     * @param  {String} alias       Alias
     * @param  {Model}  model       Model definition
     * @param  {Object} properties  Properties
     * @return {Builder}
     */
    to(alias, model, properties) {
        this._current.match( new Match(alias, model, this._convertPropertyMap(alias, properties) ) );

        return this;
    }

    /**
     * Complete the relationship statement to point to anything
     *
     * @return {Builder}
     */
    toAnything() {
        this._current.match(new Match());

        return this;
    }

    /** 
     * Build the pattern without any keywords
     * 
     * @return {String}
     */
    pattern() {
        this.whereStatement();
        this.statement();

        return this._statements.map(statement => {
            return statement.toString(false);
        }).join('\n');
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
     * @param  {String}  query_mode
     * @return {Promise}
     */
    execute(query_mode = mode.WRITE) {
        const { query, params } = this.build();

        switch (query_mode) {
            case mode.WRITE:
                return this._neode.writeCypher(query, params);

            default:
                return this._neode.cypher(query, params);
        }
    }

}