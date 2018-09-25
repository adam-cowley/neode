/* eslint-disable */
import neode from './neode';
import Person from './Person';

/**
 * Define a Person
 */
neode.model('Person', Person);


/**
 * Create a couple of People nodes
 */
Promise.all([
    neode.create('Person', {name: 'Adam'}),
    neode.create('Person', {name: 'Joe'})
])

/**
 * Log out some details and relate the two together
 */
.then(([adam, joe]) => {
    console.log('adam', adam.id(), adam.get('person_id'), adam.get('name'));
    console.log('joe', joe.id(), joe.get('person_id'), joe.get('name'));

    return adam.relateTo(joe, 'knows', {since: new Date('2017-01-02 12:34:56')});
})

/**
 * Log out relationship details
 */
.then(rel => {
    console.log('rel', rel.id(), rel.get('since'));

    return rel;
})

/**
 * Delete the two nodes
 */
.then(rel => {
    return Promise.all([
        rel.startNode().delete(),
        rel.endNode().delete()
    ]);
})

/**
 * Close Driver
 */
.then(() => neode.close());
