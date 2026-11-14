/**
The general workflow from the original neode-example, ported to neode-ogm.

Original: https://github.com/adam-cowley/neode-example/blob/master/index.js

Differences from the original (see example/README.md for the full mapping):
 - neode.model('Movie').mergeOn(match, set)  →  neode.mergeOn(neode.model('Movie'), match, set)
 - neode.merge('Director', {directed: [movie]}) works the same — nested
   entity instances create the relationships through the save path
 - adulthood.id() → adulthood._id (the elementId, hydrated via @InternalId
   or the map model's implicit _id)
*/

// Load neode-ogm with the variables stored in .env
const neode = require('../../dist')

  .fromEnv()

  // Register the map-based model definitions
  .with({
    Movie: require('./models/Movie'),
    Person: require('./models/Person'),
    Actor: require('./models/Actor'),
    Director: require('./models/Director'),
  })

// Merge a movie on the title field and add additional properties.
// Neode works out what to merge on from the schema definition
// (unique + indexed fields = merge fields)
neode
  .mergeOn(
    neode.model('Movie'),
    {
      title: 'Adulthood',
    },
    {
      description:
        'Not Straight Outta Compton, but straight out of jail and back on the mean streets of London.',
      tagline: 'Are you dizzy blud?',
    },
  )
  .then((adulthood) => {
    // Create some Actor nodes (merged on their unique name)
    return Promise.all([
      neode.mergeOn(neode.model('Actor'), { name: 'Noel Clarke' }),
      neode.mergeOn(neode.model('Actor'), { name: 'Scarlett Alice Johnson' }),
      neode.mergeOn(neode.model('Actor'), { name: 'Adam Deacon' }),
    ])
      .then(([noel, scarlett, adam]) => {
        // Relate the actors to the movie through the acts_in
        // relationship defined on the Actor model, with the
        // relationship property `name` set to their character name
        return Promise.all([
          noel.relateTo(adulthood, 'acts_in', { name: 'Sam' }),
          scarlett.relateTo(adulthood, 'acts_in', { name: 'Lexi' }),
          adam.relateTo(adulthood, 'acts_in', { name: 'Jay' }),
        ])
      })
      .then(() => adulthood)
  })
  .then((adulthood) => {
    // Merge a Director based on the name. The nested `directed` array
    // containing the Movie instance tells neode to create the
    // DIRECTED relationship between them
    return neode
      .merge(neode.model('Director'), {
        name: 'Noel Clarke',
        directed: [adulthood],
      })
      .then(() => adulthood)
  })
  .then((adulthood) => {
    // Output some results
    console.log('Created #', adulthood._id) // eslint-disable-line no-console
    console.log(JSON.stringify(adulthood.toJson(), null, 2)) // eslint-disable-line no-console
  })
  .catch((error) => {
    console.log('Error :(', error.message, error.issues) // eslint-disable-line no-console
  })
  .then(() => {
    // Close all connections to the graph
    return neode.close().then(() => {
      console.log('Shutdown') // eslint-disable-line no-console
    })
  })
