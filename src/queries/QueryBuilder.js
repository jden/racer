module.exports = QueryBuilder;

var reserved = {
    equals: 1
  , notEquals: 1
  , gt: 1
  , gte: 1
  , lt: 1
  , lte: 1
  , within: 1
  , contains: 1
};

var validQueryParams = {
    from: 1
  , byKey: 1
  , where: 1
  , skip: 1
  , limit: 1
  , sort: 1
  , except: 1
  , only: 1
};

// QueryBuilder constructor
// @param {Object} params looks like:
//   {
//     from: 'someNamespace'
//   , where: {
//       name: 'Gnarls'
//     , gender: { notEquals: 'female' }
//     , age: { gt: 21, lte: 30 }
//     , tags: { contains: ['super', 'derby'] }
//     , shoe: { within: ['nike', 'adidas'] }
//     }
//   , sort: ['fieldA', 'asc', 'fieldB', 'desc']
//   , skip: 10
//   , limit: 5
//   }
function QueryBuilder (params) {
  this._json = {};

  if (params) for (var k in params) {
    if (! (k in validQueryParams)) {
      throw new Error("Un-identified operator '" + k + "'");
    }
    this[k](params[k]);
  }
}

function keyMatch (obj, fn) {
  for (var k in obj) {
    if (fn(k)) return true;
  }
  return false;
}

function isReserved (key) { return key in reserved; }

var proto = QueryBuilder.prototype = {
    from: function (from) {
      this._json.from = from;
      return this;
    }
  , byKey: function (key) {
      this._json.byKey = key;
      return this;
    }
  , where: function (param) {
      if (typeof param === 'string') {
        this._currField = param;
        return this;
      }

      if (param.constructor !== Object) {
        console.error(param);
        throw new Error("Invalid `where` param");
      }

      for (var fieldName in param) {
        this._currField = fieldName;
        var arg = param[fieldName]
        if (arg.constructor !== Object) {
          this.equals(arg);
        } else if (keyMatch(arg, isReserved)) {
          for (var comparator in arg) {
            this[comparator](arg[comparator]);
          }
        } else {
          this.equals(arg);
        }
      }
    }
  , toJSON: function () { return this._json; }
};

QueryBuilder.fromJSON = function fromJSON (json) {
  var q = new QueryBuilder
  for (var param in json) {
    switch (param) {
      case 'type':
        q[json[param]]()
        break;
      case 'from':
      case 'byKey':
      case 'sort':
      case 'skip':
      case 'limit':
      case 'only':
      case 'except':
        q[param](json[param]);
        break;
      case 'equals':
      case 'notEquals':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
      case 'within':
      case 'contains':
        var fields = json[param];
        for (var field in fields) {
          q.where(field)[param](fields[field]);
        }
        break;
      default:
        throw new Error("Un-identified Query json property '" + param + "'");
    }
  }
  return q;
};

// We use ABBREVS for query hashing, so our hashes are more compressed.
var ABBREVS = {
        equals: '$eq'
      , notEquals: '$ne'
      , gt: '$gt'
      , gte: '$gte'
      , lt: '$lt'
      , lte: '$lte'
      , within: '$w'
      , contains: '$c'

      , byKey: '$k'

      , only: '$o'
      , except: '$e'
      , sort: '$s'
      , asc: '^'
      , desc: 'v'
      , skip: '$sk'
      , limit: '$L'
    }
  , SEP = ':';

QueryBuilder.hash = function (json) {
  var groups = []
    , nsHash
    , byKeyHash
    , selectHash
    , sortHash
    , skipHash
    , limitHash
    , group
    , fields, field;

  for (var method in json) {
    var val = json[method];
    switch (method) {
      case 'from':
        nsHash = val;
        break;
      case 'byKey':
        byKeyHash = ABBREVS.byKey + SEP + JSON.stringify(val);
        break;
      case 'only':
      case 'except':
        selectHash = ABBREVS[method];
        for (var i = 0, l = val.length; i < l; i++) {
          field = val[i];
          selectHash += SEP + field;
        }
        break;
      case 'sort':
        sortHash = ABBREVS.sort + SEP;
        for (var i = 0, l = val.length; i < l; i+=2) {
          field = val[i];
          sortHash += field + SEP + ABBREVS[val[i+1]];
        }
        break;
      case 'skip':
        skipHash = ABBREVS.skip + SEP + val;
        break;
      case 'limit':
        limitHash = ABBREVS.limit + SEP + val;
        break;

      case 'where':
        break;
      case 'within':
      case 'contains':
        for (var k in val) {
          val[k] = val[k].sort();
        }
        // Intentionally fall-through without a break
      case 'equals':
      case 'notEquals':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        group = [ABBREVS[method]];
        fields = group[group.length] = [];
        groups.push(group);
        for (field in val) {
          fields.push([field, JSON.stringify(val[field])]);
        }
        break;
    }
  }

  var hash = nsHash;
  if (byKeyHash)  hash += SEP + byKeyHash;
  if (sortHash)   hash += SEP + sortHash;
  if (selectHash) hash += SEP + selectHash;
  if (skipHash)   hash += SEP + skipHash;
  if (limitHash)  hash += SEP + limitHash;

  for (var i = groups.length; i--; ) {
    group = groups[i];
    group[1] = group[1].sort(comparator);
  }

  groups = groups.sort( function (groupA, groupB) {
    var pathA = groupA[0]
      , pathB = groupB[0];
    if (pathA < pathB)   return -1;
    if (pathA === pathB) return 0;
    return 1;
  });

  for (i = 0, l = groups.length; i < l; i++) {
    group = groups[i];
    hash += SEP + SEP + group[0];
    fields = group[1];
    for (var j = 0, m = fields.length; j < m; j++) {
      var pair = fields[j]
        , field = pair[0]
        , val   = pair[1];
      hash += SEP + field + SEP + val;
    }
  }

  return hash;
};

proto.hash = function hash () {
  return QueryBuilder.hash(this._json);
};

function comparator (pairA, pairB) {
  var methodA = pairA[0], methodB = pairB[0];
  if (methodA < methodB)   return -1;
  if (methodA === methodB) return 0;
  return 1;
}

var methods = [
    'sort'
  , 'skip'
  , 'limit'
  , 'only'
  , 'except'
];

for (var i = methods.length; i--; ) {
  var method = methods[i];
  proto[method] = (function (method) {
    return function (arg) {
      this._json[method] = arg;
      return this;
    }
  })(method);
}

methods = [
    'equals'
  , 'notEquals'
  , 'gt', 'gte', 'lt', 'lte'
  , 'within', 'contains'
];

for (method, i = methods.length; i--; ) {
  method = methods[i];
  proto[method] = (function (method) {
    // Each method `equals`, `notEquals`, etc. just populates a `json` property
    // that is a JSON representation of the query that can be passed around
    return function (val) {
      var json = this._json
        , cond = json[method] || (json[method] = {});
      cond[this._currField] = val;
      return this;
    };
  })(method);
}

proto.find = function find () {
  this._json.type = 'find';
  return this;
}

proto.findOne = function findOne () {
  this._json.type = 'findOne';
  return this;
}
