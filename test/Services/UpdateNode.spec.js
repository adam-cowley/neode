import {assert, expect} from 'chai';
import FindAll from '../../src/Services/FindAll';
import Create from '../../src/Services/Create';
import Node from '../../src/Node';

describe('UpdateNode', () => {
    let instance;
    let model;
    const label = 'UpdateTest';
    const schema = {
        uuid: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            required: true,
        },
        age: 'integer',
        enabled: {
            type: 'boolean',
            default: false,
        },
        dob: {
            type: 'datetime',
            default: Date.now,
        },
        point: {
            type: 'point',
            default: {
                latitude: 51.506164642,
                longitude: -0.124832834,
            },
        },
    }


    before(() => {
        instance = require('../instance')();
        model = instance.model(label, schema);
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => {
                return instance.close()
            })
            .then(() => done());
    });

    it('should update a node including null properties', (done) => {
        const data = {
            name: 'James',
            age: 21,
        };
        const updates = { name: 'Adam', age: null }

        Create(instance, model, data)
            .then(res => {
                return res.update(updates)
            })
            .then(res => {
                // console.log(res)
                Object.keys(updates).map(key => {
                    expect(res.get(key)).to.equal(updates[ key ])
                })

                return res.toJson()
            })
            .then(json => {
                Object.keys(updates).map(key => {
                    expect(json[ key ]).to.equal(updates[ key ])
                })

                done()
            })
            .catch(e => done(e))


    })

})