

function UniqueConstraintCypher(label, property, mode = 'CREATE') {
    return `${mode} CONSTRAINT FOR (model:${label}) REQUIRE model.${property} IS UNIQUE`;
}

function ExistsConstraintCypher(label, property, mode = 'CREATE') {
    return `${mode} CONSTRAINT IF NOT EXISTS FOR (model:${label}) REQUIRE model.${property} IS UNIQUE`;
}

function IndexCypher(label, property, mode = 'CREATE') {
    return `${mode} INDEX FOR (model:${label}) ON model.${property}`;
}

function runAsync(session, queries, resolve, reject) {
    const next = queries.pop();

    return session.run(next)
        .then(() => {
            // If there is another query, let's run it
            if (queries.length) {
                return runAsync(session, queries, resolve, reject);
            }

            // Close Session and resolve
            session.close();
            resolve();
        })
        .catch(e => {
            reject(e);
        });
}

function InstallSchema(neode) {
    const queries = [];

    neode.models.forEach((model, label) => {
        model.properties().forEach(property => {
            // Constraints
            if (property.primary() || property.unique()) {
                queries.push(UniqueConstraintCypher(label, property.name()));
            }

            if (neode.enterprise() && property.required()) {
                queries.push(ExistsConstraintCypher(label, property.name()));
            }

            // Indexes
            if (property.indexed()) {
                queries.push(IndexCypher(label, property.name()));
            }
        });
    });

    return neode.batch(queries);
}

function DropSchema(neode) {
    const queries = [];

    neode.models.forEach((model, label) => {
        model.properties().forEach(property => {
            // Constraints
            if (property.unique()) {
                queries.push(UniqueConstraintCypher(label, property.name(), 'DROP'));
            }

            if (neode.enterprise() && property.required()) {
                queries.push(ExistsConstraintCypher(label, property.name(), 'DROP'));
            }

            // Indexes
            if (property.indexed()) {
                queries.push(IndexCypher(label, property.name(), 'DROP'));
            }
        });
    });

    const session = neode.writeSession();

    return new Promise((resolve, reject) => {
        runAsync(session, queries, resolve, reject);
    });
}

export default class Schema {

    constructor(neode) {
        this.neode = neode;
    }

    install() {
        return InstallSchema(this.neode);
    }

    drop() {
        return DropSchema(this.neode);
    }

}
