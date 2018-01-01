import Model from '../Model';

export default class Match {
    constructor(alias, model = false) {
        this._alias = alias;
        this._model = model;
    }

    toString() {
        let model = '';

        if ( this._model instanceof Model ) {
            model = `:${this._model.labels().join(':')}`;
        }
        else if ( this._model instanceof String ) {
            model = `:${this._model}`;
        }

        return `(${this._alias}${model ? model : ''})`;
    }
}
