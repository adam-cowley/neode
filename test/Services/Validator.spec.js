/* eslint-disable no-undef */
import {assert, expect} from 'chai';
import Validator from '../../src/Services/Validator';
import Node from '../../src/Node';
import { ERROR_VALIDATION } from '../../src/ValidationError';
import neo4j from 'neo4j-driver';


describe('Services/Validator.js', () => {
    let instance;

    before(() => {
        instance = require('../instance')();
    });

    after(() => {
        instance.close();
    });

    describe('All', () => {
        describe('valid', () => {
            it('should allow a whitelist of values', done => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        valid: ['A', 'B', 'C'],
                    },
                });

                Validator(instance, model, { value: 'D' })
                    .then(() => {
                        expect(false).to.equal(true, 'Should fail validation');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);

                        const value = e.details.find(e => e.path.includes('value'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('required', () => {
            it('should require that a value be provided', done => {
                const model = instance.model('ValidatorTest', {
                    required: {
                        type: 'string',
                        required: true,
                    },
                    notRequired: {
                        type: 'string',
                        required: false,
                    }
                });

                Validator(instance, model, {})
                    .then(() => {
                        expect(false).to.equal(true, 'Should fail validation');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);

                        expect(
                            e.details.find(e => e.path.includes('required'))
                        ).to.be.an('object');

                        expect(
                            e.details.find(e => e.path.includes('notRequired'))
                        ).to.be.undefined;
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('optional', () => {
            it('should a value to be undefined', done => {
                const model = instance.model('ValidatorTest', {
                    optional: {
                        type: 'string',
                        optional: true,
                    },
                });

                Validator(instance, model, { optional: undefined })
                    .then(res => {
                        expect(res.optional).to.be.undefined;
                    })
                    .catch(() => {
                        assert(false, 'error should not be thrown');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('forbidden', () => {
            it('should forbid values', done => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        forbidden: true,
                    },
                });

                Validator(instance, model, { value: 'smoking' })
                    .then(() => {
                        assert(false, 'value should be forbidden');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);

                        expect(
                            e.details.find(e => e.path.includes('value'))
                        ).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('strip', () => {
            it('should strip a value', done => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        strip: true,
                    },
                });

                Validator(instance, model, { value: 'value     ' })
                    .then(res => {
                        expect(res).to.not.contain.key('value');
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });
    });

    describe('Boolean', () => {
        describe('falsy', () => {
            it('should convert values to false', done => {
                const model = instance.model('ValidatorTest', {
                    falsy: {
                        type: 'boolean',
                        falsy: [ 'no' ],
                    },
                });

                Validator(instance, model, { falsy: 'no' })
                    .then(res => {
                        expect(res.falsy).to.be.false;
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('truthy', () => {
            it('should convert values to truthy', done => {
                const model = instance.model('ValidatorTest', {
                    truthy: {
                        type: 'boolean',
                        truthy: [ 'yes' ],
                    },
                });

                Validator(instance, model, { truthy: 'yes' })
                    .then(res => {
                        expect(res.truthy).to.be.true;
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('insensitive', () => {
            it('should convert values to truthy', done => {
                const model = instance.model('ValidatorTest', {
                    truthy: {
                        type: 'boolean',
                        truthy: [ 'Y' ],
                    },
                });

                Validator(instance, model, { truthy: 'y' })
                    .then(res => {
                        expect(res.truthy).to.be.true;
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });
    });

    describe('Temporal', () => {
        describe('Date', () => {
            // TODO
        });

        describe('Time', () => {
            // TODO
        });

        describe('DateTime', () => {
            describe('after', () => {
                it('should accept a date as a minimum value', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: '2018-01-01',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('2017-01-01') ) })
                        .then(() => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            const date = e.details.find(e => e.path.includes('date'));

                            expect(date).to.be.an('object');
                            expect(date.message).to.contain('after minimum');
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });

                it('should accept `now` as a minimum value', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: 'now',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('2017-01-01') ) })
                        .then(() => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            const date = e.details.find(e => e.path.includes('date'));

                            expect(date).to.be.an('object');
                            expect(date.message).to.contain('after minimum');
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });

                // TODO: Removed.  This should be handled by CleanValues and not the validator.
                // it('should accept valid string', done => {
                //     const model = instance.model('ValidatorTest', {
                //         date: {
                //             type: 'datetime',
                //             after: '2018-01-01',
                //         },
                //     });

                //     Validator(instance, model, { date: '2019-01-01' })
                //         .then(res => {
                //             console.log('>>',res);

                //             expect(res.date).to.be.an.instanceOf(Date);
                //             expect( res.date.getTime() ).to.equal( new Date('2019-01-01').getTime() );
                //         })
                //         .catch(e => {
                //             console.log(e)
                //             expect(false, e.message);
                //         })
                //         .then(() => done())
                //         .catch(e => done(e));
                // });

                // it('should accept valid date', done => {
                //     const model = instance.model('ValidatorTest', {
                //         date: {
                //             type: 'datetime',
                //             after: '2018-01-01',
                //         },
                //     });

                //     const date = new Date('2019-01-01');

                //     Validator(instance, model, { date })
                //         .then(res => {
                //             expect(res.date).to.be.an.instanceOf(Date);
                //             expect(res.date.getTime()).to.equal( date.getTime() );
                //         })
                //         .catch(e => {
                //             assert(false, e.message);
                //         })
                //         .then(() => done())
                //         .catch(e => done(e));
                // });
            });

            describe('before', () => {
                it('should accept a date as a minimum value', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2017-01-01',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('2018-01-01') ) })
                        .then(() => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            const date = e.details.find(e => e.path.includes('date'));

                            expect(date).to.be.an('object');
                            expect(date.message).to.contain('after minimum');
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });

                it('should accept `now` as a minimum value', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: 'now',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('9999-01-01') ) })
                        .then(() => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            const date = e.details.find(e => e.path.includes('date'));
                            expect(date).to.be.an('object');
                            expect(date.message).to.contain('after minimum');
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });

                it('should accept valid string', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2019-01-01',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('2019-01-01') ) })
                        .then(res => {
                            expect( res.date ).to.be.an.instanceOf(neo4j.types.DateTime);
                            expect( new Date( res.date.toString() ).getTime() ).to.equal( (new Date('2019-01-01')).getTime() );
                        })
                        .catch(e => {
                            assert(false, e.message);
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });

                it('should accept valid date', done => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2019-01-01',
                        },
                    });

                    Validator(instance, model, { date: neo4j.types.DateTime.fromStandardDate( new Date('2019-01-01') ) })
                        .then(res => {
                            expect( res.date ).to.be.an.instanceOf(neo4j.types.DateTime);
                            expect( new Date( res.date.toString() ).getTime() ).to.equal( (new Date('2019-01-01')).getTime() );
                        })
                        .catch(e => {
                            assert(false, e.message);
                        })
                        .then(() => done())
                        .catch(e => done(e));
                });
            });
        });

        describe('LocalDateTime', () => {
            // TODO
        });

        describe('LocalTime', () => {
            // TODO
        });
    });

    describe('Numbers', () => {
        describe('min', () => {
            it('should validate a minimum value', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'integer',
                        min: 10,
                    },
                });

                Validator(instance, model, { number: 5 })
                    .then(() => {
                        assert(false, 'Should fail validation');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);

                        const value = e.details.find(e => e.path.includes('number'));
                        expect(value).to.be.an('object');
                        expect(value.message).to.contain('larger than');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('max', () => {
            it('should validate a max value', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'integer',
                        max: 10,
                    },
                });

                Validator(instance, model, { number: 20 })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('number'));
                        expect(value).to.be.an('object');
                        expect(value.message).to.contain('less than');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('precision', () => {
            it('should convert a number to ', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        precision: 2,
                    },
                });

                Validator(instance, model, { number: 1.229 })
                    .then(res => {
                        expect(res.number).to.equal(1.23);
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('multiple', () => {
            it('should validate a multiple of provided value', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'int',
                        multiple: 2,
                    },
                });

                Validator(instance, model, { number: neo4j.int(3) })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('number'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('positive', () => {
            it('should reject a negative number', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        positive: true,
                    },
                });

                Validator(instance, model, { number: -3 })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('number'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });

            it('should accept a positive number', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        positive: true,
                    },
                });

                Validator(instance, model, { number: 3 })
                    .then(res => {
                        expect(res.number).to.equal(3);
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('negative', () => {
            it('should reject a positive number', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        negative: true,
                    },
                });

                Validator(instance, model, { number: 3 })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('number'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });

            it('should accept a negative number', done => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        negative: true,
                    },
                });

                Validator(instance, model, { number: -3 })
                    .then(res => {
                        expect(res.number).to.equal(-3);
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });
    });

    describe('Strings', () => {
        describe('regex', () => {
            it('should validate regex expression', done => {
                const model = instance.model('ValidatorTest', {
                    regex: {
                        type: 'string',
                        regex: new RegExp('/([a-z]+)/')
                    },
                });

                Validator(instance, model, { regex: 20 })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('regex'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });

            it('should validate regex expression with options', done => {
                const model = instance.model('ValidatorTest', {
                    regex: {
                        type: 'string',
                        regex: {
                            pattern: /([a-z]+)/,
                            invert: true,
                            name: 'myRule'
                        }
                    },
                });

                Validator(instance, model, { regex: 20 })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('regex'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });

            it('should accept valid string', done => {
                const model = instance.model('ValidatorTest', {
                    regex: {
                        type: 'string',
                        regex: {
                            pattern: /([a-z]+)/,
                            invert: true,
                            name: 'myRule'
                        }
                    },
                });

                Validator(instance, model, { regex: 'ABC' })
                    .then(res => {
                        expect(res.regex).to.equal('ABC');
                    })
                    .catch(e => {
                        assert(false, e.message)
                    })

                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('replace', () => {
            it('should replace a pattern', () => {
                const model = instance.model('ValidatorTest', {
                    replace: {
                        type: 'string',
                        replace: {
                            pattern: /a/g,
                            replace: 'X',
                        },
                    },
                });

                Validator(instance, model, { replace: 'adam' })
                    .then(res => {
                        expect(res.replace).to.equal('XdXm');
                    })
                    .catch(e => {
                        assert(false, e.message);
                    });
            });

        });

        describe('email', () => {
            it('should validate option as boolean', done => {
                const model = instance.model('ValidatorTest', {
                    email: {
                        type: 'string',
                        email: true,
                    },
                });

                Validator(instance, model, { email: 'invalid' })
                    .then(() => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        const value = e.details.find(e => e.path.includes('email'));
                        expect(value).to.be.an('object');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });

            it('should validate option with configuration', done => {
                const model = instance.model('ValidatorTest', {
                    email: {
                        type: 'string',
                        email: {
                            tlds: { allow: true },
                        },
                    },
                });

                Validator(instance, model, { email: 'hello@example.com' })
                    .then(res => {
                        expect(res.email).to.equal('hello@example.com');
                    })
                    .catch(e => {
                        assert(false, e.message);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });
    });

    describe('UUID', () => {
        it('should reject an invalid uuid v4', done => {
            const model = instance.model('ValidatorTest', {
                uuid: {
                    type: 'uuid',
                },
            });

            Validator(instance, model, { uuid: 'invalid' })
                .then(() => {
                    assert(false, 'Should fail validation')
                })
                .catch(e => {
                    const value = e.details.find(e => e.path.includes('uuid'));
                    expect(value).to.be.an('object');
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept a valid uuidv4', done => {
            const model = instance.model('ValidatorTest', {
                uuid: {
                    type: 'uuid',
                },
            });

            Validator(instance, model, { uuid: '6bfa94dc-6534-4a02-a0ea-ccb5a2275441' })
                .then(res => {
                    expect(res.uuid).equal('6bfa94dc-6534-4a02-a0ea-ccb5a2275441');
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('Nodes', () => {
        it('should accept a string', done => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: 'valid' })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept an object', done => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: {id: 'invalid'} })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept a node', done => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: new Node })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('Relationships', () => {
        it('should accept a string', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, {
                relationship: {
                    prop: 'value',
                    node: '1234',
                }
            })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept an aliased string', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    alias: 'alias',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, {
                relationship: {
                    prop: 'value',
                    alias: '1234',
                }
            })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept an object', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { node: {id: 'alias'} })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept an aliased object', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    alias: 'alias',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { node: {id: 'alias'} })
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should accept a node', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { relationship: {prop: 'value', node: new Node }})
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should require a relationship', done => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { relationship: {prop: 'value', node: new Node }})
                .then(() => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });


    describe('Spatial', () => {
        it('should fail if latitude and longitude are passed', done => {
            const model = instance.model('ValidatorTest', {
                point: {
                    type: 'point',
                },
            });

            Validator(instance, model, { point: { latitude: 37.795972, longitude: -122.407994} })
                .then(() => {
                    assert(false, 'Should fail validation');
                })
                .catch(e => {
                    const value = e.details.find(e => e.path.includes('point'));

                    expect(value).to.be.an('object');
                    expect(value.message).to.contain('Point');
                })

                .then(() => done())
                .catch(e => done(e));;
        });

        it('should pass is valid point is passed', done => {
            const model = instance.model('ValidatorTest', {
                point: {
                    type: 'point',
                },
            });

            Validator(instance, model, { point: new neo4j.types.Point(4326, 37.795972, -122.407994) })
                .then(() => done())
                .catch(e => done(e));
        });
    });

});