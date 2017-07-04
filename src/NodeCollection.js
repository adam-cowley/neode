export default class NodeCollection {
    constructor(neode, values) {
        this._neode = neode;
        this._values = values;
    }

    get length() {
        return this._values.length;
    }

    get(index) {
        return this._values[index];
    }

    map(fn) {
        return this._values.map(fn);
    }

    forEach(fn) {
        return this._values.forEach(fn);
    }

}