import {assert, expect} from 'chai';
import GenerateDefaultValues from '../../src/Services/GenerateDefaultValues';

<<<<<<< HEAD
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
=======
describe('Services/GenerateDefaultValues.js', () => {
    let instance;
    let model;

    const label = 'GenerateDefaultValues';
    const schema = {
        uuid: 'uuid',
        someNumber: 'integer',

        defaultFunction: {
            type: 'string',
            default: () => '_DEFAULT_',
        },

        defaultValue: {
            type: 'number',
            default: 100,
        },
    };

    before(() => {
        instance = require('../instance')();
        model = instance.model(label, schema);
    });

    after(() => {
        instance.close();
    });

    describe('::GenerateDefaultValues', () => {
        it('should throw an error when something other than an object is passed', done => {
            try {
                GenerateDefaultValues(instance, model, null);

                done(new Error('Error not thrown'));
            }
            catch(e) {
                done();
            }
        })

        it('should not treat 0 as a null value', done => {
            const input = { someNumber: 0 };

            GenerateDefaultValues(instance, model, input)
                .then(output => {
                    expect(input.someNumber).to.deep.equal(output.someNumber);
                    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(output.uuid)).to.equal(true);

                    done();
                })
                .catch(e => done(e));
        });

        it('should generate a default based on the function', done => {
            GenerateDefaultValues(instance, model, {})
                .then(output => {
                    expect(output.defaultValue).to.deep.equal(schema.defaultValue.default);

                    done();
                })
                .catch(e => done(e));
        });

        it('should generate a default based on a literal value', done => {
            GenerateDefaultValues(instance, model, {})
                .then(output => {
                    expect(output.defaultFunction).to.deep.equal(schema.defaultFunction.default());

>>>>>>> release/0.2.0
                    done();
                })
                .catch(e => done(e));
        });
<<<<<<< HEAD
=======

        
>>>>>>> release/0.2.0
    });

});
