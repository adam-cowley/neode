import Relationship from './Relationship';
import RelationshipType from '../RelationshipType';
import Property from './Property';

export default class Statement {
    constructor(prefix) {
        this._prefix = prefix || 'MATCH';
        this._pattern = [];
        this._where = [];
        this._order = [];
        this._detach_delete = [];
        this._delete = [];
        this._return = [];
        this._set = [];
        this._on_create_set = [];
        this._on_match_set = [];
        this._remove = [];
    }

    match(match) {
        this._pattern.push(match);

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

    delete(...values) {
        this._delete = this._delete.concat(values);

        return this;
    }

    detachDelete(...values) {
        this._detach_delete = this._detach_delete.concat(values);

        return this;
    }

    return(...values) {
        this._return = this._return.concat(values);

        return this;
    }

    relationship(relationship, direction, alias, degrees) {
        if ( relationship instanceof RelationshipType ) {
            const rel = relationship;

            relationship = rel.relationship();
            direction = rel.direction();
        }

        this._pattern.push(new Relationship(relationship, direction, alias, degrees));

        return this;
    }

    set(key, value, operator = '=') {
        this._set.push( new Property(key, value, operator) );

        return this;
    }
    
    setRaw(items) {
        this._set = this._set.concat(items);

        return this;
    }

    onCreateSet(key, value, operator = '=') {
        this._on_create_set.push( new Property(key, value, operator) );

        return this;
    }

    onMatchSet(key, value, operator = '=') {
        this._on_match_set.push( new Property(key, value, operator) );

        return this;
    }

    /**
     * 
     * @param {Array} items 
     */
    remove(items) {
        this._remove = this._remove.concat(items);

        return this;
    }

    toString(includePrefix = true) {
        const output = [];

        if (this._pattern.length) {
            if ( includePrefix ) output.push(this._prefix);

            output.push(this._pattern.map(statement => {
                return statement.toString();
            }).join(''));
        }

        if (this._where.length) {
            output.push(this._where.map(statement => {
                return statement.toString();
            }).join(''));
        }

        if ( this._remove.length ) {
            output.push('REMOVE');

            output.push(this._remove.join(', '));
        }

        if ( this._on_create_set.length ) {
            output.push('ON CREATE SET');

            output.push(this._on_create_set.map(output => {
                return output.toString();
            }).join(', '));
        }


        if ( this._on_match_set.length ) {
            output.push('ON MATCH SET');

            output.push(this._on_match_set.map(output => {
                return output.toString();
            }).join(', '));
        }


        if ( this._set.length ) {
            output.push('SET');

            output.push(this._set.map(output => {
                return output.toString();
            }).join(', '));
        }

        if (this._delete.length) {
            output.push('DELETE');

            output.push(this._delete.map(output => {
                return output.toString();
            }));
        }

        if (this._detach_delete.length) {
            output.push('DETACH DELETE');

            output.push(this._detach_delete.map(output => {
                return output.toString();
            }));
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
