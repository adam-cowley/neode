export default class WhereBetween {

    constructor(alias, floor, ceiling) {
        this._alias = alias;
        this._floor = floor;
        this._ceiling = ceiling;
        this._negative = false;
    }

    setNegative() {
        this._negative = true;
    }

    toString() {
        const negative = this._negative ? 'NOT ' : '';

        return `${negative}$${this._floor} <= ${this._alias} <= $${this._ceiling}`;
    }

}