export default class Return {
    constructor(alias, as) {
        // TODO: Does alias carry an 'as' value?
        this._alias = alias;
        this._as = as;
    }

    toString() {
        let output = this._alias;

        if (this._as) {
            output += ' AS '+ this._as;
        }

        return output;
    }
}