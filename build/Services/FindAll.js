'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = FindAll;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _EagerUtils = require('../Query/EagerUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function FindAll(neode, model, properties, order, limit, skip) {
    var alias = 'this';

    var builder = new _Builder2.default(neode);

    // Match
    builder.match(alias, model);

    // Where
    if (properties) {
        Object.keys(properties).forEach(function (key) {
            builder.where(alias + '.' + key, properties[key]);
        });
    }

    // Order
    if (typeof order == 'string') {
        builder.orderBy(alias + '.' + order);
    } else if ((typeof order === 'undefined' ? 'undefined' : _typeof(order)) == 'object') {
        Object.keys(order).forEach(function (key) {
            builder.orderBy(alias + '.' + key, order[key]);
        });
    }

    // Output
    var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model);

    return builder.return(output).limit(limit).skip(skip).execute(_Builder.mode.READ).then(function (res) {
        return neode.hydrate(res, alias);
    });
}