export default class WithStatement {
    constructor(...args) {
        this._with = args;
    }

    toString() {
        const vars = this._with.join(',');
        return 'WITH '+  vars;
    }
}