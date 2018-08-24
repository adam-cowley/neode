// TODO: Rename this, NodePattern?
import Model from '../Model';

export default class Match {
    constructor(alias, model = false, properties = []) {
        this._alias = alias;
        this._model = model;
        this._properties = properties;
    }

    toString() {
        const alias = this._alias || ''; 
        let model = '';
        let properties = '';

        if ( this._model instanceof Model ) {
            model = `:${this._model.labels().join(':')}`;
        }
        else if ( typeof this._model == 'string' ) {
            model = `:${this._model}`;
        }

        if ( this._properties.length ) {
            properties = ' { ';

            properties += this._properties.map(property => {
                return property.toInlineString();
            }).join(', ');

            properties += ' }';
        }
        
        return `(${alias}${model ? model : ''}${properties})`;
    }
}
