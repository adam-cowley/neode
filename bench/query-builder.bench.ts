import { bench, describe } from 'vitest';
import Builder, { Direction } from '../src/query';

describe('Query builder', () => {
    bench('simple match + return', () => {
        new Builder().match('n', 'Person').return('n').build();
    });

    bench('match + where + orderBy + paging', () => {
        new Builder()
            .match('n', 'Person')
            .where('n.name', 'Adam')
            .orderBy('n.name', 'DESC')
            .return('n')
            .skip(10)
            .limit(5)
            .build();
    });

    bench('merge + sets + relationship pattern', () => {
        new Builder()
            .merge('this', ['Person'], { id: 'abc-123' })
            .onCreateSet('this.createdAt', 1700000000)
            .set('this.name', 'Adam')
            .set('this.email', 'adam@example.com')
            .relationship('KNOWS', Direction.OUTGOING, 'r')
            .to('other', 'Person')
            .return('this', 'elementId(this) AS __id')
            .build();
    });

    bench('variable-length path', () => {
        new Builder()
            .match('n', 'Person')
            .relationship(['KNOWS', 'LIKES'], Direction.BOTH, 'r', '1..3')
            .toAnything()
            .return('n')
            .build();
    });
});
