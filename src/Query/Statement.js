export default class Statement {
    constructor() {
        this._match = [];
        this._where = [];
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

    return(values) {
        this._return = values;
    }

    toString() {
        let output = [];

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

        return output.join('\n');
    }
}
