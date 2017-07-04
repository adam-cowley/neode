export default class Statement {
    constructor() {
        this._match = [];
        this._where = [];
        this._order = [];
        this._return = [];
    }

    match(match) {
        this._match.push(match);

        return this;
    }

    where(where) {
        this._where.push(where);

        return this;
    }

    limit(limit) {
        this._limit = limit;
    }

    skip(skip) {
        this._skip = skip;
    }

    order(order) {
        this._order.push(order);
    }

    return(...values) {
        this._return = this._return.concat(values);

        return this;
    }

    toString() {
        const output = [];

        if (this._match.length) {
            output.push('MATCH');

            output.push(this._match.map(statement => {
                return statement.toString();
            }));
        }

        if (this._where.length) {
            output.push(this._where.map(statement => {
                return statement.toString();
            }).join(''));
        }

        if (this._return.length) {
            output.push('RETURN');

            output.push(this._return.map(output => {
                return output.toString();
            }));
        }

        if (this._order.length) {
            output.push('ORDER BY');

            output.push(this._order.map(output => {
                return output.toString();
            }));
        }

        if ( this._skip ) {
            output.push(`SKIP ${this._skip}`);
        }

        if ( this._limit ) {
            output.push(`LIMIT ${this._limit}`);
        }

        return output.join('\n');
    }
}
