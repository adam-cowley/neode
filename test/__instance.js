import Neode from '../src/index';

function createInstance() {
    return Neode.fromEnv();
}

module.exports = createInstance;


    /** Testing * /
    before(done => {
        instance = require('../instance')();
        model = instance.model(label, schema);

        instance.deleteAll(label).then(() => done())
    });
    after(() => instance.close());
    /** End Testing */