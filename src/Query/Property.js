export default class Property {
    constructor(property, param, operator = '=') {
        this._property = property;
        this._param = `$${param}` || 'null';
        this._operator = operator;
    }

    toString() {
        return `${this._property} ${this._operator} ${this._param}`.trim();
    }

    toInlineString() {
        return `${this._property}: ${this._param}`.trim();
    }
}
