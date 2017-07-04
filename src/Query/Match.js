export default class Match {
    constructor(alias, model) {
        this._alias = alias;
        this._model = model;
    }

    toString() {
        const labels = typeof this._model == 'string' ? this._model : this._model.labels().join(':');

        return `(${this._alias}:${labels})`;
    }
}
