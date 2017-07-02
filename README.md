# Neode

Neode is a Neo4j ORM for Node JS.


## Installation
```
npm install --save neode
```

## Usage
```
// index.js
import Neode from 'neode';

const instance = new Neode('bolt://localhost:7474', 'username', 'password');
```

### Enterprise Mode

To initiate Neode in enterprise mode and enable enterprise features, provide a true variable as the fourth parameter.

```
// index.js
import Neode from 'neode';

const instance = new Neode('bolt://localhost:7474', 'username', 'password', true);
```

### Usage with .env variables
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

```
// index.js
import Neode from 'neode';

const instance = new Neode.fromEnv();
```

## Schema

Neode will install the schema created by the constraints defined in your Node definitions.

### Installing the Schema
```
instance.schema.install()
    .then(() => console.log('Schema installed!'))
```

**Note:** `exists` constraints will only be created when running in enterprise mode.  Attempting to create an exists constraint on Community edition will cause a `Neo.DatabaseError.Schema.ConstraintCreationFailed` to be thrown.

### Dropping the schema
Dropping the schema will remove all indexes and constraints created by Neode.  All other indexes and constraints will be left intact.

```
instance.schema.drop()
    .then(() => console.log('Schema dropped!'))
```


## Defining a `Node` Definition

```
instance.model(name, schema);
```

### Schema Object
```
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

#### Property Types
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

#### Validation

Validation is provided by Joi.  Certain data types (float, integer, boolean) will also be type cast.

- required


### Defining Relationships

Relationships can be created in the schema or defined retrospectively.

```
instance.model(label).relationship(type, relationship, direction, label, schema);
```

```
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

## Creating a Node

```
instance.create(label, properties);
instance.model(label).create(properties);
```

```
instance.create('Person', {
    name: 'Adam'
})
.then(adam => {
    console.log(adam.get('name')); // 'Adam'
});

```

## Merging a Node
Nodes are merged based on the indexes and constraints.

```
instance.merge(label, properties);
instance.model(label).merge(properties);
```

```
instance.merge('Person', {
    person_id: 1234,
    name: 'Adam',
});
```

### Merge On Specific Properties
If you know the properties that you would like to merge on, you can use the `mergeOn` method.

```
instance.mergeOn(label, match, set);
instance.model(label).mergeOn(match, set);
```
```
instance.mergeOn('Person', {person_id: 1234}, {name: 'Adam'});
```

## TODO

- Node
  - Create node with properties
  - Create
  - Merge on Indexes
  - Cast Primary Key as required & unique
  - Create Relationships On Create/Merge
  - Delete Node dependencies (delete/deleteAll)

- Relationships
  - Relationship Constraints
  - Define Dependencies
  - Delete dependencies when deleting a node

- Query Builder

- Housekeeping
  - npm run build
  - Submit to npm
  - Tests/Code Coverage
