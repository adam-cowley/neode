import Model from '../Model';

export default class Match {
    constructor(alias, model) {
        this._alias = alias;
        this._model = model;
    }

    toString() {
        const model = this._model instanceof Model ? ':' + this._model.labels().join(':') : `:${this._model}`;

        return `(${this._alias}${model})`;
    }
}
