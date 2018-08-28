import { DIRECTION_IN, DIRECTION_OUT, ALT_DIRECTION_IN, ALT_DIRECTION_OUT } from '../RelationshipType';

export default class Relationship {
    constructor(relationship, direction, alias, traversals) {
        this._relationship = relationship;
        this._direction = direction ? direction.toUpperCase() : '';
        this._alias = alias;
        this._traversals = traversals;
    }

    toString() {
        const dir_in = this._direction == DIRECTION_IN || this._direction == ALT_DIRECTION_IN ? '<' : '';
        const dir_out = this._direction == DIRECTION_OUT || this._direction == ALT_DIRECTION_OUT ? '>' : '';
        const alias = this._alias ? `${this._alias}` : '';

        let relationship = this._relationship || '';

        if ( Array.isArray(relationship) ) {
            relationship = relationship.join('`|`');
        }

        if ( relationship != '' ) {
            relationship = `:\`${relationship}\``;
        }

        const traversals = this._traversals ? `*${this._traversals}` : '';

        const rel = this._relationship || this._alias || this._traversals ? `[${alias}${relationship}${traversals}]` : '';

        return `${dir_in}-${rel}-${dir_out}`;
    }
}
