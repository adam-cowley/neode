import {assert, expect} from 'chai';
import Node from '../../src/Node';
import {ValidationError} from '../../src/ValidationError';

describe('Services/Create.js', () => {
    const instance = require('../instance');

    const label = 'CreateTest';

    instance.model(label, {
        id: {
            type: 'string',
            required: true,
            unique: true,
        },
        name: {
            type: 'string',
            required: true,

        },
        age: {
            type: 'number',
            index: true,
            default: 30
        }
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => done())
            .catch(e => done(e));
    });

    it('should throw a validation error when validation fails', (done) => {
        instance.create(label, {})
            .then(res => {
                done(new Error('Should not be triggered'));
            })
            .catch(e => done())
    });

    it('should create a record with default values and ignore undefined values', (done) => {
        const data = {
            id: 'defaultvalues',
            name: 'neode',
            ignoreme: 'ignoreme'
        };

        instance.create(label, data)
            .then(res => {
                expect(res).to.be.an.instanceOf(Node);
                expect(res.get('id')).to.equal(data.id);
                expect(res.get('name')).to.equal(data.name);
                expect(res.get('age')).to.equal(30);

                expect(res.get('ignoreme')).not.to.equal(data.ignoreme);

                done();
            })
            .catch(e => done(e))
    });

});