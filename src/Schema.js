

function UniqueConstraintCypher(label, property, mode = 'CREATE') {
    return `${mode} CONSTRAINT ON (model:${label}) ASSERT model.${property} IS UNIQUE`;
}

function ExistsConstraintCypher(label, property, mode = 'CREATE') {
    return `${mode} CONSTRAINT ON (model:${label}) ASSERT EXISTS(model.${property})`;
}

function IndexCypher(label, property, mode = 'CREATE') {
    return `${mode} INDEX ON :${label}(${property})`;
}


function InstallSchema(neode) {
    const queries = [];

    neode.models.forEach((model, label) => {
        model.properties().forEach(property => {
            // Constraints
            if (property.unique()) {
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

    return neode.batch(queries);
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