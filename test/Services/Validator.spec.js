/* eslint-disable no-undef */
import {assert, expect} from 'chai';
import Validator from '../../src/Services/Validator';
import Node from '../../src/Node';
import { ERROR_VALIDATION } from '../../src/ValidationError';


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
            it('should allow a whitelist of values', () => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        valid: ['A', 'B', 'C'],
                    },
                });

                Validator(instance, model, { value: 'D' })
                    .then(res => {
                        expect(false).to.equal(true, 'Should fail validation');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);
                        expect(e.details).to.be.an('object');
                        expect(e.details.value).to.be.an('array');
                    })
            });
        });

        describe('required', () => {
            it('should require that a value be provided', () => {
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
                    .then(res => {
                        expect(false).to.equal(true, 'Should fail validation');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);
                        expect(e.details).to.be.an('object');
                        expect(e.details).contains.key('required');
                        expect(e.details).not.contains.key('notRequired');
                    })
            });
        });

        describe('optional', () => {
            it('should a value to be undefined', () => {
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
                    .catch(e => {
                        assert(false, 'error should not be thrown');
                    });
            });
        });

        describe('forbidden', () => {
            it('should forbid values', () => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        forbidden: true,
                    },
                });

                Validator(instance, model, { value: 'smoking' })
                    .then(res => {
                        assert(false, 'value should be forbidden');
                    })
                    .catch(e => {
                        expect(e.message).to.equal(ERROR_VALIDATION);
                        expect(e.details).to.be.an('object');
                        expect(e.details).contains.key('value');
                    });
            });
        });

        describe('strip', () => {
            it('should strip a value', () => {
                const model = instance.model('ValidatorTest', {
                    value: {
                        type: 'string',
                        strip: true,
                    },
                });

                Validator(instance, model, { value: 'value     ' })
                    .then(res => {
                        expect(res).to.not.contain.key('value')
                    })
                    .catch(e => {
                        assert(false, e.message)
                    });
            });
        });
    });

    describe('Boolean', () => {
        describe('falsy', () => {
            it('should convert values to false', () => {
                const model = instance.model('ValidatorTest', {
                    falsy: {
                        type: 'boolean',
                        falsy: [ 'no' ],
                    },
                });

                Validator(instance, model, { falsy: 'no' })
                    .then(res => {
                        expect(res.falsy).to.be.false
                    })
                    .catch(e => {
                        assert(false, e.message)
                    });
            });
        });

        describe('truthy', () => {
            it('should convert values to truthy', () => {
                const model = instance.model('ValidatorTest', {
                    truthy: {
                        type: 'boolean',
                        truthy: [ 'yes' ],
                    },
                });

                Validator(instance, model, { truthy: 'yes' })
                    .then(res => {
                        expect(res.truthy).to.be.true
                    })
                    .catch(e => {
                        assert(false, e.message)
                    });
            });
        });

        describe('insensitive', () => {
            it('should convert values to truthy', () => {
                const model = instance.model('ValidatorTest', {
                    truthy: {
                        type: 'boolean',
                        truthy: [ 'Y' ],
                    },
                });

                Validator(instance, model, { truthy: 'y' })
                    .then(res => {
                        expect(res.truthy).to.be.true
                    })
                    .catch(e => {
                        assert(false, e.message)
                    });
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
                it('should accept a date as a minimum value', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: '2018-01-01',
                        },
                    });

                    Validator(instance, model, { date: new Date('2017-01-01') })
                        .then(res => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            expect(e.details).to.contain.key('date');
                        });
                });

                it('should accept `now` as a minimum value', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: 'now',
                        },
                    });

                    Validator(instance, model, { date: new Date('2017-01-01') })
                        .then(res => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            expect(e.details).to.contain.key('date');
                        });
                });

                it('should accept valid string', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: '2018-01-01',
                        },
                    });

                    Validator(instance, model, { date: '2019-01-01' })
                        .then(res => {
                            expect(res.date).to.be.an.instanceOf(Date);
                            expect( res.date.getTime() ).to.equal( new Date('2019-01-01').getTime() );
                        })
                        .catch(e => {
                            expect(false, e.message);
                        });
                });

                it('should accept valid date', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            after: '2018-01-01',
                        },
                    });

                    const date = new Date('2019-01-01');

                    Validator(instance, model, { date })
                        .then(res => {
                            expect(res.date).to.be.an.instanceOf(Date);
                            expect(res.date.getTime()).to.equal( date.getTime() );
                        })
                        .catch(e => {
                            expect(false, e.message);
                        });
                });
            });

            describe('before', () => {
                it('should accept a date as a minimum value', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2017-01-01',
                        },
                    });

                    Validator(instance, model, { date: '2018-01-01' })
                        .then(res => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            expect(e.details).to.contain.key('date');
                        });
                });

                it('should accept `now` as a minimum value', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: 'now',
                        },
                    });

                    Validator(instance, model, { date: new Date('2020-01-01') })
                        .then(res => {
                            assert(false, 'Should fail validation');
                        })
                        .catch(e => {
                            expect(e.details).to.contain.key('date');
                        });
                });

                it('should accept valid string', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2019-01-01',
                        },
                    });

                    Validator(instance, model, { date: '2019-01-01' })
                        .then(res => {
                            expect(res.date).to.be.an.instanceOf(Date);
                            expect( res.date.getTime() ).to.equal( new Date('2019-01-01').getTime() );
                        })
                        .catch(e => {
                            expect(false, e.message);
                        });
                });

                it('should accept valid date', () => {
                    const model = instance.model('ValidatorTest', {
                        date: {
                            type: 'datetime',
                            before: '2019-01-01',
                        },
                    });

                    const date = new Date('2019-01-01');

                    Validator(instance, model, { date })
                        .then(res => {
                            expect(res.date).to.be.an.instanceOf(Date);
                            expect(res.date.getTime()).to.equal( date.getTime() );
                        })
                        .catch(e => {
                            expect(false, e.message);
                        });
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
            it('should validate a minimum value', () => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'integer',
                        min: 10,
                    },
                });

                Validator(instance, model, { number: 5 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('number');
                    });
            });
        });

        describe('max', () => {
            it('should validate a max value', () => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'integer',
                        max: 10,
                    },
                });

                Validator(instance, model, { number: 20 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('number');
                    });
            });
        });

        describe('precision', () => {
            it('should convert a number to ', () => {
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
                    });
            });
        });

        describe('multiple', () => {
            it('should validate a multiple of provided value', () => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'int',
                        multiple: 2,
                    },
                });

                Validator(instance, model, { number: 3 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('number');
                    });
            });
        });

        describe('positive', () => {
            it('should reject a negative number', () => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        positive: true,
                    },
                });

                Validator(instance, model, { number: -3 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('number');
                    });
            });

            it('should accept a positive number', () => {
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
                    });
            });
        });

        describe('negative', () => {
            it('should reject a positive number', () => {
                const model = instance.model('ValidatorTest', {
                    number: {
                        type: 'float',
                        negative: true,
                    },
                });

                Validator(instance, model, { number: 3 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('number');
                    });
            });

            it('should accept a negative number', () => {
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
                    });
            });
        });
    });

    describe('Strings', () => {
        describe('regex', () => {
            it('should validate regex expression', () => {
                const model = instance.model('ValidatorTest', {
                    regex: {
                        type: 'string',
                        regex: new RegExp('/([a-z]+)/')
                    },
                });

                Validator(instance, model, { regex: 20 })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('regex');
                    });
            });

            it('should validate regex expression with options', () => {
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
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('regex');
                    });
            });

            it('should accept valid string', () => {
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
                    });
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
                        assert(false, e.message)
                    });
            });

        });

        describe('email', () => {
            it('should validate option as boolean', () => {
                const model = instance.model('ValidatorTest', {
                    email: {
                        type: 'string',
                        email: true,
                    },
                });

                Validator(instance, model, { email: 'invalid' })
                    .then(res => {
                        assert(false, 'Should fail validation')
                    })
                    .catch(e => {
                        expect(e.details).to.contain.key('email');
                    });
            });

            it('should validate option with configuration', () => {
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
                    });
            });
        });
    });

    describe('UUID', () => {
        it('should reject an invalid uuid v4', () => {
            const model = instance.model('ValidatorTest', {
                uuid: {
                    type: 'uuid',
                },
            });

            Validator(instance, model, { uuid: 'invalid' })
                .then(res => {
                    assert(false, 'Should fail validation')
                })
                .catch(e => {
                    expect(e.details).to.contain.key('uuid');
                });
        });

        it('should accept a valid uuidv4', () => {
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
                });
        });
    });

    describe('Nodes', () => {
        it('should accept a string', () => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: 'valid' })
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });

        it('should accept an object', () => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: {id: 'invalid'} })
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });

        it('should accept a node', () => {
            const model = instance.model('ValidatorTest', {
                node: {
                    type: 'node',
                },
            });

            Validator(instance, model, { node: new Node })
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });
    });

    describe('Relationships', () => {
        it('should accept a string', () => {
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
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });

        it('should accept an aliased string', () => {
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
                });
        });

        it('should accept an object', () => {
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
                });
        });

        it('should accept an aliased object', () => {
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
                });
        });

        it('should accept a node', () => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { relationship: {prop: 'value', node: new Node }})
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });

        it('should require a relationship', () => {
            const model = instance.model('ValidatorTest', {
                relationship: {
                    type: 'relationship',
                    properties: {
                        prop: 'string'
                    },
                },
            });

            Validator(instance, model, { relationship: {prop: 'value', node: new Node }})
                .then(res => {
                    assert(true);
                })
                .catch(e => {
                    assert(false, e.message);
                });
        });
    });

});