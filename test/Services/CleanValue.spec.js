import {assert, expect} from 'chai';
import CleanValue from '../../src/Services/CleanValue';
import { v1 as neo4j } from 'neo4j-driver';

describe('Services/CleanValue.js', () => {

    it('should handle a float', () => {
        const input = '1.2';
        const expected = parseFloat(1.2);
        const output = CleanValue({ type: 'float' }, input);

        expect(output).to.equal(expected);
    });

    it('should handle an int', () => {
        const input = '1.2';
        const expected = parseInt(1.2);
        const output = CleanValue({ type: 'int' }, input);

        expect(output.toNumber()).to.equal(expected);
    });

    it('should handle an integer', () => {
        const input = '1.2';
        const expected = parseInt(1.2);
        const output = CleanValue({ type: 'integer' }, input);

        expect(output.toNumber()).to.equal(expected);
    });

    it('should handle a boolean', () => {
        expect( CleanValue({ type: 'boolean' }, true) ).to.equal(true);
        expect( CleanValue({ type: 'boolean' }, '1') ).to.equal(true);
        expect( CleanValue({ type: 'boolean' }, 1) ).to.equal(true);
        expect( CleanValue({ type: 'boolean' }, 'yes') ).to.equal(true);

        expect( CleanValue({ type: 'boolean' }, false) ).to.equal(false);
        expect( CleanValue({ type: 'boolean' }, null) ).to.equal(false);
        expect( CleanValue({ type: 'boolean' }, undefined) ).to.equal(false);
        expect( CleanValue({ type: 'boolean' }, 0) ).to.equal(false);
    });

    it('should handle a timestamp', () => {
        const input = new Date();
        const expected = input.getTime();
        const output = CleanValue({ type: 'timestamp' }, input);

        expect(output).to.equal(expected);
    });

    describe('Date', () => {
        it('should handle a Date', () => {
            const input = new Date();
            const output = CleanValue({ type: 'date' }, input);

            expect(output).to.be.an.instanceOf(neo4j.types.Date);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
        });

        it('should handle a Date from a timestamp', () => {
            const input = new Date;
            const output = CleanValue({ type: 'date' }, input.getTime());

            expect(output).to.be.an.instanceOf(neo4j.types.Date);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
        });
    });

    describe('DateTime', () => {
        it('should handle a DateTime', () => {
            const input = new Date();
            const output = CleanValue({ type: 'datetime' }, input);

            expect(output).to.be.an.instanceOf(neo4j.types.DateTime);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.timeZoneOffsetSeconds).to.equal(Math.abs(input.getTimezoneOffset()) * 60);
        });

        it('should handle a DateTime as a timestamp', () => {
            const input = new Date();
            const output = CleanValue({ type: 'datetime' }, input.getTime());

            expect(output).to.be.an.instanceOf(neo4j.types.DateTime);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.timeZoneOffsetSeconds).to.equal(Math.abs(input.getTimezoneOffset()) * 60);
        });
    });

    describe('LocalDateTime', () => {
        it('should handle a LocalDateTime', () => {
            const input = new Date();
            const output = CleanValue({ type: 'LocalDateTime' }, input);

            expect(output).to.be.an.instanceOf(neo4j.types.LocalDateTime);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
        });

        it('should handle a LocalDateTime as a timestamp', () => {
            const input = new Date();
            const output = CleanValue({ type: 'LocalDateTime' }, input.getTime());

            expect(output).to.be.an.instanceOf(neo4j.types.LocalDateTime);

            expect(output.year).to.equal(input.getFullYear());
            expect(output.month).to.equal(input.getMonth()+1);
            expect(output.day).to.equal(input.getDate());
            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
        });
    });

    describe('Time', () => {
        it('should handle a Time', () => {
            const input = new Date();
            const output = CleanValue({ type: 'time' }, input);

            expect(output).to.be.an.instanceOf(neo4j.types.Time);

            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.nanosecond).to.equal(input.getMilliseconds() * 1000000);
            expect(output.timeZoneOffsetSeconds).to.equal(Math.abs(input.getTimezoneOffset()) * 60);
        });

        it('should handle a Time as a timestamp', () => {
            const input = new Date();
            const output = CleanValue({ type: 'time' }, input.getTime());

            expect(output).to.be.an.instanceOf(neo4j.types.Time);

            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.nanosecond).to.equal(input.getMilliseconds() * 1000000);
            expect(output.timeZoneOffsetSeconds).to.equal(Math.abs(input.getTimezoneOffset()) * 60);
        });
    });

    describe('LocalTime', () => {
        it('should handle a LocalTime', () => {
            const input = new Date();
            const output = CleanValue({ type: 'localtime' }, input);

            expect(output).to.be.an.instanceOf(neo4j.types.LocalTime);

            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.nanosecond).to.equal(input.getMilliseconds() * 1000000);
        });

        it('should handle a LocalTime', () => {
            const input = new Date();
            const output = CleanValue({ type: 'localtime' }, input.getTime());

            expect(output).to.be.an.instanceOf(neo4j.types.LocalTime);

            expect(output.hour).to.equal(input.getHours());
            expect(output.minute).to.equal(input.getMinutes());
            expect(output.second).to.equal(input.getSeconds());
            expect(output.nanosecond).to.equal(input.getMilliseconds() * 1000000);
        });
    });

    describe('Points', () => {
        const config = { type: 'point' };

        it('should handle a lat, lng', () => {
            const input = {latitude: 51.568535, longitude: -1.772232};

            const output = CleanValue(config, input);

            expect(output.srid).to.equal(4326);
            expect(output.y).to.equal(input.latitude);
            expect(output.x).to.equal(input.longitude);
        });

        it('should handle a lat, lng, height', () => {
            const input = {latitude: 51.568535, longitude: -1.772232, height: 1000};

            const output = CleanValue(config, input);

            expect(output.srid).to.equal(4979);
            expect(output.y).to.equal(input.latitude);
            expect(output.x).to.equal(input.longitude);
            expect(output.z).to.equal(input.height);
        });

        it('should handle a x, y', () => {
            const input = {x: 1, y: 2};

            const output = CleanValue(config, input);

            expect(output.srid).to.equal(7203);
            expect(output.x).to.equal(input.x);
            expect(output.y).to.equal(input.y);
        });

        it('should handle a x, y, z', () => {
            const input = {x: 1, y: 2, z: 3};

            const output = CleanValue(config, input);

            expect(output.srid).to.equal(9157);
            expect(output.x).to.equal(input.x);
            expect(output.y).to.equal(input.y);
            expect(output.z).to.equal(input.z);
        });
    });

});