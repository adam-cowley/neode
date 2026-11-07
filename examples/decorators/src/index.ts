/**
The general workflow from the original neode-example, ported to neode-ogm
with the decorator API.

Decorator form of `examples/models/index.js` — compare side by side: the
flow is identical, only the model definitions and the registration differ
(decorated classes are self-registering; there is no `.with(...)` call).

Original: https://github.com/adam-cowley/neode-example/blob/master/index.js
*/

// Load neode-ogm with the variables stored in .env. The model classes
// register themselves on import (the decorators run at class definition).
import { fromEnv as fromEnvironment } from '../../../dist'
import type { WithMethods } from '../../../dist'
import { Actor, Director, Movie } from './models'

const n = fromEnvironment()

// Merge a movie on the title field and add additional properties.
// neode-ogm works out what to merge on from the schema definition
// (unique + indexed fields = merge fields)
n.mergeOn(
  Movie,
  {
    title: 'Adulthood',
  },
  {
    description:
      'Not Straight Outta Compton, but straight out of jail and back on the mean streets of London.',
    tagline: 'Are you dizzy blud?',
  },
)
  .then(async (adulthood) => {
    // Create some Actor nodes (merged on their name)
    return Promise.all([
      n.mergeOn(Actor, { name: 'Noel Clarke' }),
      n.mergeOn(Actor, { name: 'Scarlett Alice Johnson' }),
      n.mergeOn(Actor, { name: 'Adam Deacon' }),
    ])
      .then(async ([noel, scarlett, adam]) => {
        // Relate the actors to the movie through the acts_in
        // relationship defined on the Actor class, with the
        // relationship property `name` set to their character name
        return Promise.all([
          (noel as WithMethods<Actor>).relateTo(adulthood as WithMethods<Movie>, 'acts_in', {
            name: 'Sam',
          }),
          (scarlett as WithMethods<Actor>).relateTo(adulthood as WithMethods<Movie>, 'acts_in', {
            name: 'Lexi',
          }),
          (adam as WithMethods<Actor>).relateTo(adulthood as WithMethods<Movie>, 'acts_in', {
            name: 'Jay',
          }),
        ])
      })
      .then(() => adulthood)
  })
  .then(async (adulthood) => {
    // Merge a Director based on the name. The nested `directed` array
    // containing the Movie instance tells neode to create the
    // DIRECTED relationship between them
    return n
      .merge(Director, {
        name: 'Noel Clarke',
        directed: [adulthood],
      })
      .then(() => adulthood)
  })
  .then((adulthood) => {
    if (!adulthood) {
      throw new Error('Movie merge failed')
    }

    // Output some results
    console.log('Created #', adulthood._id) // eslint-disable-line no-console
    console.log(JSON.stringify((adulthood as WithMethods<Movie>).toJson(), null, 2)) // eslint-disable-line no-console
  })
  .catch((error: Error) => {
    console.log('Error :(', error.message) // eslint-disable-line no-console
  })
  .then(async () => {
    // Close all connections to the graph
    return n.close().then(() => {
      console.log('Shutdown') // eslint-disable-line no-console
    })
  })
