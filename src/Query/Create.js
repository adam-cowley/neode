import Model from '../Model';

export default class Create {
    constructor(alias, model = false) {
        this._alias = alias;
        this._model = model;
    }

    toString() {
        const alias = this._alias || ''; 
        let model = '';

        if ( this._model instanceof Model ) {
            model = `:${this._model.labels().join(':')}`;
        }
        else if ( typeof this._model == 'string' ) {
            model = `:${this._model}`;
        }
        
        return `(${alias}${model ? model : ''})`;
    }
}
