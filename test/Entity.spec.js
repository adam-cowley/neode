import {assert, expect} from 'chai';
import Entity, { valueToJson } from '../src/Entity';
import neo4j from 'neo4j-driver';

describe('Entity.js', () => {
    
    describe('::constructor', () => {
        // TODO: More comprehensive entity tests
    });

    describe('::valueToJson', () => {
        it('should convert an integer', () => {
            const input = new neo4j.int(1);
            const expected = 1;

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a datetime', () => {
            const input = new neo4j.types.DateTime(2012, 2, 3, 12, 45, 56, 123400000, 3600);
            const expected = '2012-02-03T12:45:56.123400000+01:00';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a date', () => {
            const input = new neo4j.types.Date(2012, 2, 3);
            const expected = '2012-02-03';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a time', () => {
            const input = new neo4j.types.Time(12, 34, 56, 123400000, 3600);
            const expected = '12:34:56.123400000+01:00';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a localdatetime', () => {
            const input = new neo4j.types.LocalDateTime(2012, 2, 3, 12, 45, 56, 123400000);
            const expected = '2012-02-03T12:45:56.123400000';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a localtime', () => {
            const input = new neo4j.types.LocalTime(12, 34, 56, 123400000);
            const expected = '12:34:56.123400000';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        it('should convert a duration', () => {
            const input = new neo4j.types.Duration(1, 2, 3, 123400000);
            const expected = 'P1M2DT3.123400000S';

            expect( valueToJson(null, input) ).to.equal(expected);
        });

        describe('Point', () => {
            it('should convert WGS 84 2D to Object', () => {
                const input = new neo4j.types.Point(4326, 1, 2);
                const expected = { latitude: 2, longitude: 1 };

                expect( valueToJson(null, input) ).to.deep.equal(expected);
            });

            it('should convert WGS 84 3D to Object', () => {
                const input = new neo4j.types.Point(4979, 1, 2, 3);
                const expected = { latitude: 2, longitude: 1, height: 3};

                expect( valueToJson(null, input) ).to.deep.equal(expected);
            });

            it('should convert Cartesian 2D to Object', () => {
                const input = new neo4j.types.Point(7203, 1, 2);
                const expected = { x: 1, y: 2 };

                expect( valueToJson(null, input) ).to.deep.equal(expected);
            });

            it('should convert Cartesian 3D to Object', () => {
                const input = new neo4j.types.Point(9157, 1, 2, 3);
                const expected = { x: 1, y: 2, z: 3};

                expect( valueToJson(null, input) ).to.deep.equal(expected);
            });
        });

    });

    

});