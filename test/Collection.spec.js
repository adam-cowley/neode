import {assert, expect} from 'chai';
import Node from '../src/Node';
import Collection from '../src/Collection';

describe('Collection.js', () => {
    const neode = '__neode__';
    const values = [1, 2, 3, 4];

    const collection = new Collection(neode, values);

    describe('::constructor', () => {
        it('should construct', () => {
            expect(collection._neode).to.equal(neode);
            expect(collection._values).to.equal(values);
        });

        it('should construct with an empty array', () => {
            const collection = new Collection(neode);
            expect(collection._neode).to.equal(neode);
            expect(collection._values).to.deep.equal([]);
        });
    });

    describe('::length', () => {
        it('should return the length', () => {
            expect(collection.length).to.equal(values.length);
        });
    });

    describe('::get', () => {
        it('should get an item from the internal values', () => {
            values.forEach((value, index) => {
                expect( collection.get(index) ).to.equal(value);
            })
        });
    });

    describe('::[Symbol.iterator]', () => {
        it('should be iterable', () => {
            const output = [];

            for ( let value of values ) {
                output.push(value);
            }

            expect( output ).to.deep.equal( values );
        });
    });

    describe('::first', () => {
        it('should get the first item in the collection', () => {
            expect(collection.first()).to.equal(values[0]);
        });
    });

    describe('::map', () => {
        it('should apply a map function to the values', () => {
            const output = collection.map(value => value * value);

            expect(output).to.deep.equal([1, 4, 9, 16]);
        });
    });

    describe('::forEach', () => {
        it('should apply a foreach function to the values', () => {
            let total = 0;

            collection.forEach(value => total += value);

            expect(total).to.equal(10);
        });
    });

    describe('::toJson', () => {
        class TestItem {
            constructor(value) {
                this.value = value;
            }

            toJson() {
                return this.value;
            }
        }

        const jsonTest = new Collection(null, [
            new TestItem(1),
            new TestItem(2),
            new TestItem(3),
            new TestItem(4),
        ]);

        it('should run the toJson() function to all values', done => {
            jsonTest.toJson()
                .then(res => {
                    expect(res).to.deep.equal([1, 2, 3, 4]);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });


});