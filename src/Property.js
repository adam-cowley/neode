/**
 *  Container holding information for a property.
 * 
 * TODO: Schema validation to enforce correct data types
 */
export default class Property {
    constructor(name, schema) {
        if ( typeof schema == 'string' ) {
            schema = {type:schema};
        }

        this._name = name;
        this._schema = schema;

        // TODO: Clean Up
        Object.keys(schema).forEach(key => {
            this['_'+ key] = schema[key];
        });
    }

    name() {
        return this._name;
    }

    type() {
        return this._schema.type;
    }

    primary() {
        return this._primary || false;
    }

    unique() {
        return this._unique || false;
    }

    exists() {
        return this._exists || false;
    }

    required() {
        return this._exists || this._required || false;
    }

    indexed() {
        return this._index || false;
    }

    protected() {
        return this._primary || this._protected;
    }

    hidden() {
        return this._hidden;
    }

    readonly() {
        return this._readonly || false;
    }

    convertToInteger() {
        return this._type == 'int' || this._type == 'integer';
    }
}
