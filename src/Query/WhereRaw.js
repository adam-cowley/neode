export default class WhereRaw {
    constructor(statement) {
        this._statement = statement;
    }

    toString() {
        return this._statement;
    }
}