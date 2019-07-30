'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function UniqueConstraintCypher(label, property) {
    var mode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'CREATE';

    return mode + ' CONSTRAINT ON (model:' + label + ') ASSERT model.' + property + ' IS UNIQUE';
}

function ExistsConstraintCypher(label, property) {
    var mode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'CREATE';

    return mode + ' CONSTRAINT ON (model:' + label + ') ASSERT EXISTS(model.' + property + ')';
}

function IndexCypher(label, property) {
    var mode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'CREATE';

    return mode + ' INDEX ON :' + label + '(' + property + ')';
}

function runAsync(session, queries, resolve, reject) {
    var next = queries.pop();

    return session.run(next).then(function () {
        // If there is another query, let's run it
        if (queries.length) {
            return runAsync(session, queries, resolve, reject);
        }

        // Close Session and resolve
        session.close();
        resolve();
    }).catch(function (e) {
        reject(e);
    });
}

function InstallSchema(neode) {
    var queries = [];

    neode.models.forEach(function (model, label) {
        model.properties().forEach(function (property) {
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
    var queries = [];

    neode.models.forEach(function (model, label) {
        model.properties().forEach(function (property) {
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

    var session = neode.session();

    return new Promise(function (resolve, reject) {
        runAsync(session, queries, resolve, reject);
    });
}

var Schema = function () {
    function Schema(neode) {
        _classCallCheck(this, Schema);

        this.neode = neode;
    }

    _createClass(Schema, [{
        key: 'install',
        value: function install() {
            return InstallSchema(this.neode);
        }
    }, {
        key: 'drop',
        value: function drop() {
            return DropSchema(this.neode);
        }
    }]);

    return Schema;
}();

exports.default = Schema;