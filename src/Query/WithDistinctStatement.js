export default class WithDistinctStatement {
    constructor(...args) {
        this._with = args;
    }

    toString() {
        const vars = this._with.join(',');
        return 'WITH DISTINCT '+  vars;
    }
}