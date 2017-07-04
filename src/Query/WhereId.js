export default class WhereId {
    constructor(alias, param) {
        this._alias = alias;
        this._param = param;
    }

    toString() {
        return `id(${this._alias}) = {${this._param}}`;
    }
}
