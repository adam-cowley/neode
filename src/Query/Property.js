export default class Property {
    constructor(property, param) {
        this._property = property;
        this._param = `$${param}` || 'null';
    }

    toString() {
        return `${this._property} = ${this._param}`.trim();
    }

    toInlineString() {
        return `${this._property}: ${this._param}`.trim();
    }
}
