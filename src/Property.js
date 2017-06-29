export default class Property {
    constructor(name, schema) {
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
        return this.schema.type
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
}
