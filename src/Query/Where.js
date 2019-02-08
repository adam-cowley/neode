export const OPERATOR_EQUALS = '=';

export default class Where {

    constructor(left, operator, right) {
        this._left = left;
        this._operator = operator;
        this._right = right;
        this._negative = false;
    }

    setNegative() {
        this._negative = true;
    }

    toString() {
        const negative = this._negative ? 'NOT ' : '';

        return `${negative}${this._left} ${this._operator} ${this._right}`;
    }

}