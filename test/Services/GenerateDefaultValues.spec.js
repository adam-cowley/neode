import {assert, expect} from 'chai';
import GenerateDefaultValues from '../../src/Services/GenerateDefaultValues';

describe('GenerateDefaultValues.js', () => {
    const instance = require('../instance');
    const label = 'GenerateDefaultValues';
    const schema = {
        someNumber: 'integer',
    };

    const model = instance.model(label, schema);

    describe('::GenerateDefaultValues', () => {
        it('should not treat 0 as a null value', (done) => {
            const input = { someNumber: 0 };

            GenerateDefaultValues(instance, instance.model(label), input)
                .then(output => {
                    expect(input).to.deep.equal(output);
                    done();
                })
                .catch(e => done(e));
        });
    });

});
