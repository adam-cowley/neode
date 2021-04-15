"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = FindWithinDistance;

var _Builder = _interopRequireWildcard(require("../Query/Builder"));

var _EagerUtils = require("../Query/EagerUtils");

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function _getRequireWildcardCache() { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj["default"] = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function FindWithinDistance(neode, model, location_property, point, distance, properties, order, limit, skip) {
  var alias = 'this';
  var builder = new _Builder["default"](neode); // Match

  builder.match(alias, model); // Where

  if (properties) {
    Object.keys(properties).forEach(function (key) {
      builder.where("".concat(alias, ".").concat(key), properties[key]);
    });
  } // Prefix key on Properties


  if (properties) {
    Object.keys(properties).forEach(function (key) {
      properties["".concat(alias, ".").concat(key)] = properties[key];
      delete properties[key];
    });
  } // Distance from Point
  // TODO: When properties are passed match them as well .where(properties);


  var pointString = isNaN(point.x) ? "latitude:".concat(point.latitude, ", longitude:").concat(point.longitude) : "x:".concat(point.x, ", y:").concat(point.y);

  if (!isNaN(point.z)) {
    pointString += ", z:".concat(point.z);
  }

  if (!isNaN(point.height)) {
    pointString += ", height:".concat(point.height);
  }

  builder.whereRaw("distance (this.".concat(location_property, ", point({").concat(pointString, "})) <= ").concat(distance)); // Order

  if (typeof order == 'string') {
    order = "".concat(alias, ".").concat(order);
  } else if (_typeof(order) == 'object') {
    Object.keys(order).forEach(function (key) {
      builder.orderBy("".concat(alias, ".").concat(key), order[key]);
    });
  } // Output


  var output = (0, _EagerUtils.eagerNode)(neode, 1, alias, model); // Complete Query

  return builder.orderBy(order).skip(skip).limit(limit)["return"](output).execute(_Builder.mode.READ).then(function (res) {
    return neode.hydrate(res, alias);
  });
}