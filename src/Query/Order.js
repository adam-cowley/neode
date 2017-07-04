export default class Order {
    constructor(what, how) {
        this._what = what;
        this._how = how || '';
    }

    toString() {
        return `${this._what} ${this._how}`.trim();
    }
}
