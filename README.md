# Neode

Neode is a Neo4j OGM for Node JS designed to take care of the CRUD boilerplate involved with setting up a neo4j project with Node.  Just install, set up your models and go.

- [Getting Started](#getting-started)
- [Reading from the Graph](#reading)
- [Writing to the Graph](#writing)
- [Query Builder](#query-builder)
- [Schema](#schema)


## Getting Started

### Installation
```javascript
npm install --save neode
```

### Usage
```javascript
// index.js
import Neode from 'neode';

const instance = new Neode('bolt://localhost:7687', 'username', 'password');
```

#### Enterprise Mode

To initiate Neode in enterprise mode and enable enterprise features, provide a true variable as the fourth parameter.

```javascript
// index.js
import Neode from 'neode';

const instance = new Neode('bolt://localhost:7687', 'username', 'password', true);
```

#### Usage with .env variables
```
npm i --save dotenv
```

```
// .env
NEO4J_PROTOCOL=bolt
NEO4J_HOST=localhost
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j
NEO4J_PORT=7687
```

```javascript
// index.js
import Neode from 'neode';

const instance = new Neode.fromEnv();
```

#### Additional Driver Config

Additional driver configuration can be passed as the fifth parameter in the constructor, or defined in .env:

```
NEO4J_ENCRYPTED=ENCRYPTION_ON                   # ENCRYPTION_ON or ENCRYPTION_OFF
NEO4J_TRUST=TRUST_SIGNED_CERTIFICATES           # TRUST_ALL_CERTIFICATES, TRUST_ON_FIRST_USE, TRUST_SIGNED_CERTIFICATES, TRUST_CUSTOM_CA_SIGNED_CERTIFICATES, TRUST_SYSTEM_CA_SIGNED_CERTIFICATES
NEO4J_TRUSTED_CERTIFICATES=/path/to/cert.pem
NEO4J_KNOWN_HOSTS=127.0.0.1
NEO4J_MAX_CONNECTION_POOLSIZE=100
NEO4J_MAX_TRANSACTION_RETRY_TIME=5000
NEO4J_LOAD_BALANCING_STRATEGY=least_connected   # least_connected or round_robin
NEO4J_MAX_CONNECTION_LIFETIME=36000
NEO4J_CONNECTION_TIMEOUT=36000
NEO4J_DISABLE_LOSSLESS_INTEGERS=false
```


#### Loading `with` Models

You can use the `with()` method to load multipe models at once.

```javascript
const neode = require('neode')
    .fromEnv()
    .with({
        Movie: require('./models/Movie'),
        Person: require('./models/Person')
    });

```

#### Load from Directory

You can load a directory of models by calling the `withDirectory()` method.

```javascript
// models/Person.js
module.exports = {
  id: {
    type: 'uuid',
    primary: true
  },
  name: 'string'
}
```

```javascript
// index.js
instance.withDirectory(__dirname+'/models');
```

### Defining a Node Definition

Neode revolves around the notion of node definitions, or `Model`s.  To interact with the graph, you will need to define a node, identified by a `name` and with a `schema` of properties.

```javascript
instance.model(name, schema);
```

#### Schema Object
```javascript
instance.model('Person', {
    person_id: {
        primary: true,
        type: 'uuid',
        required: true, // Creates an Exists Constraint in Enterprise mode
    },
    payroll: {
        type: 'number',
        unique: 'true', // Creates a Unique Constraint
    },
    name: {
        type: 'name',
        indexed: true, // Creates an Index
    },
    age: 'number' // Simple schema definition of property : type
});
```

##### Property Types
- string
- number
  - int
  - float
- boolean
- relationship
  - type
  - relationship: Neo4j relationship type
  - target: node definition
  - properties: `schema`

##### Validation

Validation is provided by Joi.  Certain data types (float, integer, boolean) will also be type cast.

- required
- string
  - min
  - max
- number
  - min
  - max


#### Defining Relationships

Relationships can be created in the schema or defined retrospectively.

```javascript
instance.model(label).relationship(type, relationship, direction, label, schema);
```

```javascript
instance.model('Person').relationship('knows', 'KNOWS', 'out', 'Person', {
    since: {
        type: 'number',
        required: true,
    },
    defaulted: {
        type: 'string',
        default: 'default'
    }
});
```

#### Eager Loading

You can eager load relationships in a `findAll()` call by setting the `eager` property inside the relationship schema to `true`.

```javascript
{
    acts_in: {
        type: "relationship",
        target: "Movie",
        relationship: "ACTS_IN",
        direction: "out",
        properties: {
            name: "string"
        },
        eager: true // <-- eager load this relationship
    }
}
```

Eager loaded relationships can be retrieved by using the `get()` method.  A `NodeCollection` instance will be returned.

```
const person = person.find({name: "Tom Hanks"})
const movies = person.get('acts_in');
const first = movies.first();
```


### Extending a Schema definition
You can inherit the schema of a class and extend by calling the extend method.

```
instance.extend(original, new, schema)
```

```javascript
instance.extend('Person', 'Actor', {
    acts_in: {
        type: "relationship",
        target: "Movie",
        relationship: "ACTS_IN",
        direction: "out",
        properties: {
            name: "string"
        }
    }
})
```

## Reading

### Running a Cypher Query

```
instance.cypher(query, params)
```

```javascript
instance.cypher('MATCH (p:Person {name: {name}}) RETURN p', {name: "Adam"})
    .then(res => {
        console.log(res.records.length);
    })
```

### Running a Batch
Batch queries run within their own transaction.  Transactions can be sent as either a string or an object containing `query` and `param` propertes.

```
instance.batch(queries)
```

```javascript
instance.batch([
    {query: 'CREATE (p:Person {name: {name}}) RETURN p', params: {name: "Adam"}},
    {query: 'CREATE (p:Person {name: {name}}) RETURN p', params: {name: "Joe"}},
    {query: 'MATCH (first:Person {name: {first_name}}), (second:Person {name:{second_name}}) CREATE (first)-[:KNOWS]->(second)', params: {name: "Joe"}}
])
    .then(res => {
        console.log(res.records.length);
    })
```


### Get `all` Nodes

```
instance.all(label, properties)
instance.model(label).all(properties)
```

```javascript
instance.all('Person', {name: 'Adam'}, {name: 'ASC', id: 'DESC'}, 1, 0)
    .then(collection => {
        console.log(collection.length); // 1
        console.log(collection.get(0).get('name')); // 'Adam'
    })
```

### Get Node by Internal Node ID
```
instance.findById(label, id)
instance.model(label).findById(id)
```

```javascript
instance.findById('Person', 1)
    .then(person => {
        console.log(person.id()); // 1
    });
```

### Get Node by Primary Key
Neode will work out the model's primary key and query based on the supplied value.
```
instance.find(label, id)
instance.model(label).find(id)
```

```javascript
instance.find('Person', '1234')
    .then(res => {...});
```

### First by Properties

#### Using a key and value
```
instance.first(label, key, value)
instance.first(label).first(key, value)
```
```javascript
instance.first('Person', 'name', 'Adam')
    .then(adam => {...})
```


#### Using multiple properties
```
instance.first(label, properties)
instance.first(label).first(properties)
```
```javascript
instance.first('Person', {name: 'Adam', age: 29})
    .then(adam => {...})
```



## Writing

### Creating a Node
```javascript
instance.create(label, properties);
instance.model(label).create(properties);
```

```javascript
instance.create('Person', {
    name: 'Adam'
})
.then(adam => {
    console.log(adam.get('name')); // 'Adam'
});
```

### Merging a Node
Nodes are merged based on the indexes and constraints.

```javascript
instance.merge(label, properties);
instance.model(label).merge(properties);
```

```javascript
instance.merge('Person', {
    person_id: 1234,
    name: 'Adam',
});
```

### Merge On Specific Properties
If you know the properties that you would like to merge on, you can use the `mergeOn` method.

```javascript
instance.mergeOn(label, match, set);
instance.model(label).mergeOn(match, set);
```
```javascript
instance.mergeOn('Person', {person_id: 1234}, {name: 'Adam'});
```

### Updating a Node
You can update a Node instance directly by calling the `update()` method.

```javascript
instance.create('Person', {name: 'Adam'})
    .then(adam => adam.update({age: 29}));
```

### Creating a Relationships
You can relate two nodes together by calling the `relateTo()` method.

```javascript
model.relateTo(other, type, properties)
```
```javascript
Promise.all([
    instance.create('Person', {name: 'Adam'}),
    instance.create('Person', {name: 'Joe'})
])
.then(([adam, joe]) => {
    adam.relateTo(joe, 'knows', {since: 2010})
        .then(res => {
            console.log(rel.from().get('name'), ' has known ', rel.to().get('name'), 'since', rel.get('since'));  // Adam has known Joe since 2010
        });
});
```

**Note:** when creating a relationship defined as `in` (`DIRECTION_IN`), from `from()` and `to()` properties will be inversed regardless of which model the relationship is created by.

### Deleting a node
You can delete a Node instance directly by calling the `delete()` method.

```javascript
instance.create('Person', {name: 'Adam'})
  .then(adam => adam.delete());
```

#### Cascade Deletion
While deleting a Node with the `delete()` method, you can delete any dependant nodes or relationships.  For example, when deleting a Movie you may also want to remove any reviews but keep the actors.

You cna do this by setting the `cascade` property of a relationship to `"delete"` or `"detach"`.  `"delete"` will remove the node and relationship by performing a `DETACH DELETE`, while `"detach"` will simply remove the relationship, leaving the node in the graph.

```javascript
// Movie.js
module.exports = {
  // ...
  ratings: {
    type: 'relationship',
    'relationship': 'RATED',
    direction: 'IN',
    target: 'User',
    'cascade': 'delete'
  },
  actors: {
    type: 'relationship',
    'relationship': 'ACTS_IN',
    direction: 'IN',
    target: 'Actor',
    'cascade': 'detach'
  }
};
```

**Note**: Attempting to delete a Node without first removing any relationships will result in an error.


### Deleting a set of nodes
TODO
```javascript
instance.delete(label, where)
```

```javascript
instance.delete('Person', {living: false});
```

### Deleting all nodes of a given type
```javascript
instance.deleteAll('Person');
  .then(() => console.log('Everyone has been deleted'));
```


## Query Builder
Neode comes bundled with a query builder.  You can create a Query Builder instance by calling the `query()` method on the Neode instance.

```javascript
const builder = instance.query();
```

Once you have a Builder instance, you can start to defining the query using the fluent API.
```javascript
builder.match('p', 'Person')
    .where('p.name', 'Adam')
    .return('p');
```

For query examples, check out the [Query Builder Test suite](https://github.com/adam-cowley/neode/blob/master/test/Query/Builder.spec.js).


### Building Cypher
You can get the generated cypher query by calling the `build()` method.  This method will return an object containing the cypher query string and an object of params.

```javascript
const {query, params} = builder.build();

instance.query(query, params)
    .then(res => {
        console.log(res.records.length);
    });
```

### Executing a Query
You can execute a query by calling the `execute()` method on the query builder.

```javascript
builder.match('this', 'Node')
    .whereId('this', 1)
    .return('this')
    .execute()
    .then(res => {
        console.log(res.records.length);
    });
```


## Schema
Neode will install the schema created by the constraints defined in your Node definitions.

### Installing the Schema
```javascript
instance.schema.install()
    .then(() => console.log('Schema installed!'))
```

**Note:** `exists` constraints will only be created when running in enterprise mode.  Attempting to create an exists constraint on Community edition will cause a `Neo.DatabaseError.Schema.ConstraintCreationFailed` to be thrown.

### Dropping the schema
Dropping the schema will remove all indexes and constraints created by Neode.  All other indexes and constraints will be left intact.

```javascript
instance.schema.drop()
    .then(() => console.log('Schema dropped!'))
```


## TODO

- 3.3
  - Routing policies and countries for CC
  - Set pool size
  - Read & Write sessions/transactions
  - Encryption

- Relationships
  - Relationship Constraints
  - Delete dependencies when deleting a node beyond the first degree

- Schema
  - Composite indexes

- Query Builder
  - More where clauses
  - CREATE
  - SET
  - DELETE
  - Match Relationship
  - Match path

- Housekeeping
  - Tests/Code Coverage
