'use strict';

Object.defineProperty(exports, "__esModule", {
            value: true
});
exports.default = MergeOn;

var _GenerateDefaultValues = require('./GenerateDefaultValues');

var _GenerateDefaultValues2 = _interopRequireDefault(_GenerateDefaultValues);

var _Validator = require('./Validator');

var _Validator2 = _interopRequireDefault(_Validator);

var _Builder = require('../Query/Builder');

var _Builder2 = _interopRequireDefault(_Builder);

var _EagerUtils = require('../Query/EagerUtils');

var _WriteUtils = require('./WriteUtils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function MergeOn(neode, model, merge_on, properties, transaction) {
            return (0, _GenerateDefaultValues2.default)(neode, model, properties).then(function (properties) {
                        return (0, _Validator2.default)(neode, model, properties);
            }).then(function (properties) {
                        var alias = _WriteUtils.ORIGINAL_ALIAS;

                        var builder = new _Builder2.default(neode);

                        (0, _WriteUtils.addNodeToStatement)(neode, builder, alias, model, properties, [alias], 'merge', merge_on);

                        // Output
                        var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model);

                        return builder.return(output).execute(_Builder.mode.WRITE, transaction).then(function (res) {
                                    return neode.hydrateFirst(res, alias);
                        });
            });
} /*
  import GenerateDefaultValues from './GenerateDefaultValues';
  import Node from '../Node';
  import Validator from './Validator';
  import { DIRECTION_IN, DIRECTION_OUT } from '../RelationshipType';
  import { eagerNode } from '../Query/EagerUtils';
  
  const MAX_CREATE_DEPTH = 99;
  const ORIGINAL_ALIAS = 'this';
  */