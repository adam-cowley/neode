'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = First;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _EagerUtils = require('../Query/EagerUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function First(neode, model, key, value) {
    var alias = 'this';

    var builder = new _Builder2.default(neode);

    // Match
    builder.match(alias, model);

    // Where
    if ((typeof key === 'undefined' ? 'undefined' : _typeof(key)) == 'object') {
        // Process a map of properties
        Object.keys(key).forEach(function (property) {
            builder.where(alias + '.' + property, key[property]);
        });
    } else {
        // Straight key/value lookup
        builder.where(alias + '.' + key, value);
    }

    var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model);

    return builder.return(output).limit(1).execute(_Builder.mode.READ).then(function (res) {
        return neode.hydrateFirst(res, alias, model);
    });
}