"use strict";

function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = MergeOn;

var _GenerateDefaultValues = _interopRequireDefault(require("./GenerateDefaultValues"));

var _Validator = _interopRequireDefault(require("./Validator"));

var _Builder = _interopRequireWildcard(require("../Query/Builder"));

var _EagerUtils = require("../Query/EagerUtils");

var _WriteUtils = require("./WriteUtils");

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function _getRequireWildcardCache() { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj["default"] = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

/*
import GenerateDefaultValues from './GenerateDefaultValues';
import Node from '../Node';
import Validator from './Validator';
import { DIRECTION_IN, DIRECTION_OUT } from '../RelationshipType';
import { eagerNode } from '../Query/EagerUtils';

const MAX_CREATE_DEPTH = 99;
const ORIGINAL_ALIAS = 'this';
*/
function MergeOn(neode, model, merge_on, properties) {
  return (0, _GenerateDefaultValues["default"])(neode, model, properties).then(function (properties) {
    return (0, _Validator["default"])(neode, model, properties);
  }).then(function (properties) {
    var alias = _WriteUtils.ORIGINAL_ALIAS;
    var builder = new _Builder["default"](neode);
    (0, _WriteUtils.addNodeToStatement)(neode, builder, alias, model, properties, [alias], 'merge', merge_on); // Output

    var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model);
    return builder["return"](output).execute(_Builder.mode.WRITE).then(function (res) {
      return neode.hydrateFirst(res, alias);
    });
  });
}