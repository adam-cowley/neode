'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = FindById;

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _EagerUtils = require('../Query/EagerUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function FindById(neode, model, id) {
    var alias = 'this';

    var builder = new _Builder2.default(neode);

    return builder.match(alias, model).whereId(alias, id).return((0, _EagerUtils.eagerNode)(neode, 1, alias, model)).limit(1).execute(_Builder.mode.READ).then(function (res) {
        return neode.hydrateFirst(res, alias, model);
    });
}