'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = Find;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _Factory = require('../Factory');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function Find(neode, model, key, value) {
    var alias = 'this';
    var output = [alias];

    var builder = new _Builder2.default(neode);

    builder.match(alias, model);

    if ((typeof key === 'undefined' ? 'undefined' : _typeof(key)) == 'object') {
        Object.keys(key).map(function (property) {
            builder.where(alias + '.' + property, key[property]);
        });
    } else {
        builder.where(alias + '.' + key, value);
    }

    // Load Eager Relationships
    model.eager().forEach(function (relationship) {
        var key = '' + _Factory.eager + relationship.type();

        builder.optionalMatch(alias).relationship(relationship.relationship(), relationship.direction()).to(key, relationship.target());

        output.push('COLLECT(' + key + ') as ' + key);
    });

    return builder.return(output).limit(1).execute().then(function (res) {
        return neode.hydrateFirst(res, alias, model);
    });

    /*
        const alias = 'this';
        const output = [alias];
    
        // Prefix key on Properties
        if (properties) {
            Object.keys(properties).forEach(key => {
                properties[ `${alias}.${key}` ] = properties[ key ];
    
                delete properties[ key ];
            });
        }
    
        // Prefix key on Order
        if (typeof order == 'string') {
            order = `${alias}.${order}`;
        }
        else if (typeof order == 'object') {
            Object.keys(order).forEach(key => {
                order[ `${alias}.${key}` ] = order[ key ];
    
                delete order[ key ];
            });
        }
    
        const builder = new Builder(neode);
    
        // Match
        builder.match(alias, model)
            .where(properties);
    
    
    
        // Complete Query
        builder.orderBy(order)
            .skip(skip)
            .limit(limit)
            .return(...output);
    
        return builder.execute()
            .then(res => neode.hydrate(res, alias));
        */
}