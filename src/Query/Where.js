export const OPERATOR_EQUALS = '=';

export default class Where {

    constructor(left, operator, right) {
        this._left = left;
        this._operator = operator;
        this._right = right;
    }

    toString() {
        return `${this._left} ${this._operator} ${this._right}`;
    }

}