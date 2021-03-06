/*eslint no-underscore-dangle:0*/
'use strict';

/*!
 * Module dependencies
 */
var AWS, DOC; // loaded JIT with settings
var util = require('util');
var Connector = require('loopback-connector').Connector;
var async = require('async');
var MAX_BATCH_SIZE = 25;

// Load parse library with custom operators for DynamoDB
var parse = require('jsep');
var binaries = ["BETWEEN","AND","IN","OR","="];
var unaries = ["SET", "REMOVE", "ADD", "NOT"];
binaries.forEach(function(b) { parse.addBinaryOp(b,10); });
unaries.forEach(function(u) { parse.addUnaryOp(u,10); });

var uuid = require('node-uuid');
var debug = false;
try {
  debug = require('debug')('dynamo');
} catch(err) {
  //we have installed this package somewhere else and devDependencies are not installed.
}
var bunyan = require('bunyan');
var logger = bunyan.createLogger({name: 'dynamo'});
if (debug && debug.enabled) {
  logger.level('debug');
}

/**
 * The constructor for the DynamoDB connector
 * @param {Object} client The DOC.DynamoDB client object
 * @param {Object} dataSource The data source instance
 * @constructor
 */
function DynamoDB(client, dataSource) {
  Connector.call(this, 'dynamodb', dataSource.settings);
  this.client = client;

  this.dataSource = dataSource;
}

util.inherits(DynamoDB, Connector);

/**
 * Test connection to DynamoDB
 * @param {Function} [cb] The callback function
 *
 * @callback cb
 * @param {Error} err The error object
 * @param {Client} client The DynamoDB DOC object
 */
DynamoDB.prototype.connect = function(cb) {
  var self = this;
  if (self.client) {
  process.nextTick(function () {
    if (cb) {
    cb(null, self.client);
    }
  });
  } else {
  if (cb) {
    cb(null, self.client);
  }
  }
};

/**
 * Get types associated with the connector
 * @returns {String[]} The types for the connector
 */
DynamoDB.prototype.getTypes = function() {
  return ['db', 'nosql'];
};

/**
 * Get the default data type for ID
 * @returns {Function} The default type for ID
 */
DynamoDB.prototype.getDefaultIdType = function() {
  return String;
};

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} entity The primary model entity
 * @param {Object} document The document data to be created
 * @param {Object} properties The defined dcoument properties
 * @param {String} projection The path from the primary entity root to the document
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.createDocument = function (model, entity, document, properties, projection, cb) {
  var me = this;
  var ppath = parameterizePath(projection);
  var params = {
    Key: me.getPrimaryKeyValues(model, entity),
    TableName: me.tableName(model),
    UpdateExpression: "SET " + ppath.path + " = :document",
    ExpressionAttributeValues: { ":document": document },
    ExpressionAttributeNames: ppath.ExpressionAttributeNames,
    ReturnValues: "ALL_NEW"
  };
  me.client.updateItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data.Attributes);
  });
}

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} entity The primary model entity
 * @param {Object} document The document data to be updated
 * @param {Object} properties The defined dcoument properties
 * @param {String} projection The path from the primary entity root to the document
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.updateDocument = function (model, entity, document, projection, cb) {
  var me = this;
  var expressions = me.computeExpression(model, document, projection);
  var params = {
    Key: me.getPrimaryKeyValues(model, entity),
    TableName: me.tableName(model),
    ReturnValues: "ALL_NEW"
  };
  for(var exp in expressions)
    params[exp] = expressions[exp];
  me.client.updateItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data.Attributes);
  });
}

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} entity The primary model entity
 * @param {String} projection The path from the primary entity root to the document
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.locateDocument = function(model, entity, projection, cb) {
  var me = this;
  var ppath = parameterizePath(projection);
  var params = {
    Key: me.getPrimaryKeyValues(model, entity),
    TableName: me.tableName(model),
    ProjectionExpression: ppath.path,
    ExpressionAttributeNames: ppath.ExpressionAttributeNames
  };
  me.client.getItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data.Item);
  });
}

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} entity The primary model entity
 * @param {String} projection The path from the primary entity root to the document
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.listDocuments = function(model, entity, projection, cb) {
  var me = this;
  var ppath = parameterizePath(projection);
  var params = {
    Key: me.getPrimaryKeyValues(model, entity),
    TableName: me.tableName(model),
    ProjectionExpression: ppath.path,
    ExpressionAttributeNames: ppath.ExpressionAttributeNames
  };
  me.client.getItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data.Item);
  });
}

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} entity The primary model entity
 * @param {String} projection The path from the primary entity root to the document
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.delDocument = function(model, entity, projection, cb) {
  var me = this;
  var ppath = parameterizePath(projection);
  var params = {
    Key: me.getPrimaryKeyValues(model, entity),
    TableName: me.tableName(model),
    UpdateExpression: "REMOVE " + ppath.path,
    ExpressionAttributeNames: ppath.ExpressionAttributeNames
  };
  me.client.updateItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data.Item);
  });
}

/**
 * Create a new model instance for the given data
 * @param {String} model The model name
 * @param {Object} data The model data
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.create = function (model, data, cb) {
  /* Note: We need to create the table name beforehand since
   the table generation will take a few seconds; Or we need to
   use the wait API call until the table is created to
   proceed to insert records into the table
  */

  debug && debug("Create " + model + ".");
  debug && debug(data);

  var primaryKeys = this.getPrimaryKeyProperties(model),
    hashKeyProperty = this.idKey(model),
    itemToPut

  primaryKeys.forEach(function (primaryKey) {
    if (data[primaryKey.key] === undefined) {
      if (primaryKey.type === 'S') {
        data[primaryKey.key] = uuid.v1();
      } else if (primaryKey.type === 'N') {
        //Try time since epoch to set it automatically.
        data[primaryKey.key] = new Date() / 1;
      }
    } else if(primaryKey.type === 'N') {
      data[primaryKey.key] = Number(data[primaryKey.key]);
    }
  });


  debug && debug("Data after id auto-generated:");
  debug && debug(data);

  //The dynamo doc library does not like undefined values.
  var sanitizedData = this.sanitizeData(data);

  itemToPut = sanitizedData;

  var params = {
      TableName: this.tableName(model),
      Item: itemToPut
    };

  debug && debug("Data after sanitation");
  debug && debug(params);

  this.client.putItem(params, function(err, data) {
    if(err) {
      debug.enabled && debug(err,params);
      cb(err);
    } else {
      debug && debug("Put response:");
      debug && debug(data);
      debug("Create " + model + " success.",itemToPut);
      cb(null, itemToPut[hashKeyProperty]);
    }
  });
};

DynamoDB.prototype.idKey = function (model) {
  var primaryKeys = this.getPrimaryKeyProperties(model),
    hashKey;

  primaryKeys.forEach(function (key) {
    if (key.isHash) {
      hashKey = key.key;
    }
  });

  return hashKey;
};

DynamoDB.prototype.sanitizeData = function (data, allowUndefined) {
  var self = this;
  if (data) {
    Object.keys(data).forEach(function (key) {
    if(!allowUndefined && data[key] === undefined) {
      data[key] = null;
    }
    else if (data[key] === "")
      data[key] = null
    else if (data[key] instanceof Date) {
      data[key] = data[key] / 1;
    } else if (util.isArray(data[key])) {
      data[key] = data[key].map(function (value) {
        var subKey = self.sanitizeData({data:value});
        return subKey.data;
      });
    } else if (typeof data[key] === "object") {
      data[key] = self.sanitizeData(data[key]);
    }
    });
  }
  return data;
};

/**
 * Save the model instance for the given data
 * @param {String} model The model name
 * @param {Object} data The model data
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.save = function(model, data, cb) {
  debug && debug("Save " + model + ".");
  debug && debug(data);
  this.updateAttributes(model, null, data, cb);
};

/**
 * Check if a model instance exists by id
 * @param {String} model The model name
 * @param {*} id The id value
 * @param {Function} [cb] The callback function
 *
 */
DynamoDB.prototype.exists = function (model, id, cb) {
  debug && debug("Exists " + model + " id: " + id);
  id = this.convertId(model, id);
  var idWhere = this.getIdWhere(model, id);
  this.client.getItem({
    TableName: this.tableName(model),
    Key: idWhere
  }, function (err, data) {
    if (err) {
      debug.enabled && debug(err,params);
      cb(err);
    } else {
      if(Object.keys(data).length === 0) cb(null, false);
      else cb(null, true);
    }
  });
};

/**
 * Find a model instance by id
 * @param {String} model The model name
 * @param {*} id The id value
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.find = function find(model, id, cb) {
  debug && debug("Find single " + model + " id: " + id);

  var idWhere = this.getIdWhere(model, id),
    self = this,
    findParams = {
      TableName: this.tableName(model),
      Key: idWhere
    };

  debug && debug(findParams);

  this.client.getItem(findParams, function (err, data) {
    if (err) {
      debug.enabled && debug(err,params);
      cb(err);
    } else {
      self.castDatePropertiesBackToDate(model, data.Item);
      cb(null, data.Item);
    }
  });
};

/**
 * Delete a model instance by id
 * @param {String} model The model name
 * @param {*} id The id value
 * @param [cb] The callback function
 */
DynamoDB.prototype.destroy = function destroy(model, id, cb) {
  var me = this;
  var params = {
    TableName: me.tableName(model),
    Key: me.getPrimaryKeyValues(model, {id: id})
  };
  if(id != null)
    for(var field in params.Key)
      params.Key[field] = this.convertId(model, id);

  me.client.deleteItem(params, function(err,data) {
    if (err) {
      debug.enabled && debug(err,params);
      cb(err);
    }
    else cb(null, data);
  });
};

/**


 * Retrieve all model IDs.
 *
 * @param {String} model The model name
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.scanIds = function scanIds(model, callback) {
  var me = this;
  debug && debug("Getting all " + model + " ids.");
  var ids = [];
  me.getPrimaryKeyProperties(model).forEach(function(pkp) {
    ids.push(pkp.key);
  });

  var scanParams = {
    TableName: me.tableName(model),
    ProjectionExpression: ids.join(", ")
  };
  var items = [], scans = 0;
  function scan() {
    me.client.scan(scanParams, function(err, data) {
      scans++;
      if(err) {
        callback(err);
        debug.enabled && debug("Scan failed:",err);
      }
      else {
        debug.enabled && debug(scans + " scans completed, " + data.Items.length + " items scanned, " + items.length + " items total");
        items = items.concat(data.Items);
        if(data.LastEvaluatedKey) {
          scanParams.ExclusiveStartKey = data.LastEvaluatedKey;
          scan();
        } else {
          callback(null, items);
        }
      }
    });
  }
  scan();
};

/**


 * Find matching model instances by the filter
 *
 * @param {String} model The model name
 * @param {Object} filter The filter
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.all = function all(model, filter, cb) {
  debug && debug("Getting all " + model);
  debug && debug(filter);
  filter = this.convertFilter(model, filter);
  /**
    * Ideally we would support the full filter syntax for loopback.
    * Initially, just going to support the fields.

    *** Note -- Object syntax seems to be the only thing supported at this layers
    * fields  Object, Array, or String
      Specify fields to include in or exclude from the response.
      See Fields filter.

    (*** Note -- NOT SUPPORTED RIGHT NOW
    * include String, Object, or Array
       Include results from related models, for relations such as belongsTo and hasMany.
      See Include filter.)

    * limit   Number
       Limit the number of instances to return.
      See Limit filter.

    *** Note, order will only work if a range key has been specified properly.
      So if this is part of the filter, it's assuming the table was setup to allow
      it to be used.  Keys: RangeKeyCondition, ScanIndexForward
      This will only work if the order property is the range key in the same index
      this is being used to query in the "where" object.
    * order   String
       Specify sort order: ascending or descending.
      See Order filter.


    *** DynamoDB keys LastEvaluatedKey and ExclusiveStartKey as progressive queries are made until limit and skip are met.
    * skip (offset)   Number
       Skip the specified number of instances.
      See Skip filter.

    *** Note, where will only work in a performant fashion if the primary key, a LocalSecondaryIndex or a GlobalSecondaryIndex
      contains all the keys in the where clause.  Otherwise, the whole table is scanned.  Additionally, the more complex query
      notation defined in /loopback-datasource-juggler/lib/dao.js ~line 620 in the documentation for the find
      method is NOT fully supported.

      Each property in the where clause might have a special "inc" key, which is an array of acceptable values.

    * where   Object
       Specify search criteria; similar to a WHERE clause in SQL.
      See Where filter.
    **/

  //Because dynamodb only returns 1 MB at a time, we might need to query multiple times to populate this array.
  var items = [],
    conditions = [],
    queryParams = {},
    properties = filter.where ? Object.keys(filter.where) : null,
    findOperation = properties ? "query" : "scan",
    whereIsIndexed = true,
    me = this;


  if (properties) {
    properties.forEach(function (property) {
      if (!me.isInPrimaryIndex(property)) {
        whereIsIndexed = false;
      }
    });
  }

  //We have to use scan if the where clause is not indexed.
  if (!whereIsIndexed) {
    findOperation = "scan";
  }


  if (!cb) {
    cb = filter;
  }

  queryParams.TableName = this.tableName(model);

  if (properties) {
    if (findOperation === 'query' && !me.whereCanBeQueried(filter.where)) {
      findOperation = "scan";
    }

    me.addWhereObjectToConditions(queryParams, findOperation, filter.where);
  }

  if (filter.order && findOperation === "query") {
    var order = filter.order.split(' ');
    if (order[1] === 'ASC') {
      queryParams.ScanIndexForward = true;
    } else {
      queryParams.ScanIndexForward = false;
    }
  }

  if (filter.fields) {
    var fieldsToInclude = [];

    if (util.isArray(filter.fields)) {
      fieldsToInclude = filter.fields;
    } else {
      Object.keys(filter.fields).forEach(function (key) {
        if (filter.fields[key]) {
          fieldsToInclude.push(key);
        }
      });
    }

    queryParams.AttributesToGet = fieldsToInclude;

  }

  if (findOperation === "scan" && !queryParams.AttributesToGet) {
    queryParams.Select = 'ALL_ATTRIBUTES';
  }
  // There is no attribute values, then delete property.
  if (Object.keys(queryParams.ExpressionAttributeValues).length === 0) {
    delete queryParams.ExpressionAttributeValues;
  }
  function runQuery(params, cb) {
    if (filter.limit) {
      var max = filter.skip ? filter.limit + filter.skip : filter.limit;
      if (items.length >= max) {
        cb(null);
      }
    }
    debug && debug('findOperation: %s, queryParams:%j', findOperation, params);
    if (findOperation === 'scan') {
      logger.warn('!!!TABLE FULL SCAN OCCURED!!!');
    }
    me.client[findOperation](params, function (err, data) {
      if (err) {
        debug.enabled && debug(err,params);
        cb(err);
        return;
      }

      if (data.Items) {
        items = items.concat(data.Items);
      }

      //If there is more data to read then read it.
      if (data.LastEvaluatedKey) {
        params.ExclusiveStartKey = data.LastEvaluatedKey;
        runQuery(params, cb);
        return;
      }

      cb();
    });
  }

  runQuery(queryParams, function (err) {
    if (err) {
      debug && debug("Error doing query");
      debug && debug(err,queryParams);
      cb(err);
      return;
    }
    //At many items as we can find that are near the limit.  It may be more items than the limit
    //Trim to match the query.
    if (filter.limit) {
      var maxNumberOfItems = filter.limit,
        start = filter.skip ? filter.skip : 0;

      if (items.length >= maxNumberOfItems) {
        items = items.slice(start, Math.min(maxNumberOfItems + start, items.length));
      }
    }

    process.nextTick(function () {
      items.forEach(function (item) {
        me.castDatePropertiesBackToDate(model, item);
      });
      debug && debug("Retrieved :");
      debug && debug(items);
      if (filter && filter.include) {
        me._models[model].model.include(items, filter.include, cb);
      } else {
        cb(err, items);
      }
    });


  });
};

DynamoDB.prototype.runAll = function (model, where, cb) {
  //If no criteria is provided, refuse to perform the costly scan/delete operation.
  if (!where) {
    this.all(model, cb);
  } else {
    this.all(
      model,
      {
        "where": where
      },
      cb
    );
  }
};

DynamoDB.prototype.batches = function(model, where, cb) {
  this.runAll(model, where, function(err, data) {
    if(err) return cb(err);
    var batches = [];
    while(data.length) {
      batches.push(data.splice(0, MAX_BATCH_SIZE));
    }
    cb(null, batches);
  });
};

/**
 * Delete all instances for the given model
 * @param {String} model The model name
 * @param {Object} [where] The filter for where
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.destroyAll = function destroyAll(model, where, cb) {
  debug && debug("Destroying all " + model);
  if (!cb) {
    cb = where;
    where = null;
  }

  var table = this.tableName(model);
  var me = this;
  var handleDestroy = function(items, cb) {
    if(!items || !items.length) return cb();
      var batchParams = {
          RequestItems: {},
          ReturnConsumedCapacity: 'NONE',
          ReturnItemCollectionMetrics: 'NONE'
        },
        primaryKeyProperties = me.getPrimaryKeyProperties(model);

      batchParams.RequestItems[table] = [];
      items.forEach(function (item) {
        var deleteRequest = {
          DeleteRequest: { Key: {} }
        };
        primaryKeyProperties.forEach(function (key) {
          deleteRequest.DeleteRequest.Key[key.key] = item[key.key];
        });
        batchParams.RequestItems[table].push(deleteRequest);
      });
      me.client.batchWriteItem(batchParams, cb);
  };

  this.batches(model, where, function(err, batches) {
    if(err) {
      debug.enabled && debug(err);
      if(cb) cb(err);
      return;
    }
    async.map(batches, handleDestroy, function(err, results) {
      if(err) {
        debug.enabled && debug(err);
        if(cb) cb(err);
        return;
      }
      cb(null, results);
    });
  });
};

/**
 * Count the number of instances for the given model
 *
 * @param {String} model The model name
 * @param {Function} [cb] The callback function
 * @param {Object} filter The filter for where
 *
 */
DynamoDB.prototype.count = function count(model, cb, where) {
  debug && debug("Performing count on: ");
  debug && debug(model);
  var properties = where ? Object.keys(where) : [],
    conditions = [],
    me = this;


  this.all(model, {where: where}, function (err, items) {
    if (items) {
      cb(err, items.length);
    } else {
      cb(err, null);
    }
  });
};

DynamoDB.prototype.baseUpdate = function baseUpdate(model, id, data, condition, cb) {
  var me = this;
  data = me.sanitizeData(data, true);

  var expressions = me.computeExpression(model, data);
  debug.enabled && debug("expressions:",expressions);
  if(!expressions) return cb();
  var updateParams = {
    TableName: me.tableName(model),
    Key: me.getPrimaryKeyValues(model, data),
    ReturnValues: "ALL_NEW"
  };
  for(var exp in expressions)
    updateParams[exp] = expressions[exp];
  if(condition) {
    var conditionParams = me.parameterizeExpressions(condition);
    updateParams = me.copyParameters(conditionParams, updateParams);

    // copy updated condition
    updateParams.ConditionExpression = conditionParams.expressions[0];
  }

  if(id != null)
    for(var field in updateParams.Key)
      updateParams.Key[field] = this.convertId(model, id);
  debug.enabled && debug(updateParams);
  me.client.updateItem(updateParams, function(err,data) {
    if(err) {
      debug.enabled && debug(updateParams,err);
      cb(err);
    }
    else cb(null, data.Attributes);
  });
};

/**
 * Update properties for the model instance data
 *
 * Updates in loopback are implicit merges, so first get the object, then merge it.
 *
 * @param {String} model The model name
 * @param {Object} data The model data
 * @param {Function} [cb] The callback function
 *
 *
 * Must have an id -- seems to get called by update and update All in other connectors
 */
DynamoDB.prototype.updateAttributes = function updateAttributes(model, id, data, cb) {
  this.baseUpdate(model, id, data, null, cb);
};

/**
 * Update all matching instances
 * @param {String} model The model name
 * @param {Object} entity The entity to be updated
 * @callback {Function} cb Callback function
 */
DynamoDB.prototype.updateSingle = function (model, entity, cb) {
  debug && debug("Update/UpdateAll on:");
  debug && debug(model);
  debug && debug(entity);
  this.updateAttributes(model, null, entity, cb);
};

DynamoDB.prototype.updateConditionally = function(model, entity, condition, cb) {
  this.baseUpdate(model, null, entity, condition, cb);
};

/**
 * Update all matching instances
 * @param {String} model The model name
 * @param {Object} where The search criteria
 * @param {Object} data The property/value pairs to be updated
 * @callback {Function} cb Callback function
 */
DynamoDB.prototype.update =
  DynamoDB.prototype.updateAll = function (model, where, data, cb) {
  var me = this;

  debug && debug("Update/UpdateAll on:");
  debug && debug(model);
  debug && debug(where);
  debug && debug(data);
  this.runAll(model, where, function (err, items) {

    async.each(items, function (item, done) {
      for(var field in data)
        item[field] = data[field];
      me.updateAttributes(model, null, item, done);
    }, cb);
  });
};

/**
 * Clean a Table Name
 * @param {String} model Model to select table name from
 * @returns String
 * @type String
 */
DynamoDB.prototype.tableSanitized = function(model) {
  model = model.replace(/[^a-zA-Z0-9_\-\.]/, '');

  if (model.length < 3) {
  var i = model.length;
  while (i < 3) {
    model += '_';
    i++;
  }
  } else if (model.length > 255) {
  model = model.substring(0, 255);
  }

  return model;
};

/**
 * Perform automigrate for the given models.
 *
 * @param {String[]} [models] A model name or an array of model names. If not present, apply to all models
 * @param {Function} [cb] The callback function
 */
DynamoDB.prototype.automigrate = function (models, cb) {
  debug && debug('Performing automigrate on:');
  debug && debug(models);
  var self = this;
  if (self.client && self.dataSource) {
  if (self.debug) {
    debug('automigrate');
  }
  if ((!cb) && ('function' === typeof models)) {
    cb = models;
    models = undefined;
  }
  // First arg is a model name
  if ('string' === typeof models) {
    models = [models];
  }

  models = models || Object.keys(self._models);

  async.each(models, function (model, modelCallback) {
    if (self.debug) {
      debug('drop ')
    }

    var modelDef = self.dataSource.definitions[model];
    if (modelDef) {
      self.client.deleteTable({
        TableName: self.tableName(model)
      }, function (err, data) {
        // Ignore non-persisted model
        if (modelDef.settings.base === 'Model') {
          modelCallback();
          return;
        }
        var attributeKeys = {},
           //Initialize indexes based on special model properties. they don't exist, just do id.
          primaryIndex = modelDef.settings.primaryIndex || {hashKey: {key: self.idKey(model), type: 'S'}},
          globalSecondaryIndexes = modelDef.settings.globalSecondaryIndexes,
          tableParams = {
            KeySchema: [{
              AttributeName: primaryIndex.hashKey.key,
              KeyType: 'HASH'
            }],
            ProvisionedThroughput: {
              ReadCapacityUnits: 1,
              WriteCapacityUnits: 1
            }
          };

        if (primaryIndex.rangeKey) {
          tableParams.KeySchema.push({
            AttributeName: primaryIndex.rangeKey.key,
            KeyType: 'RANGE'
          });
        }

        attributeKeys[primaryIndex.hashKey.key] = primaryIndex.hashKey;

        if (primaryIndex.rangeKey) {
          attributeKeys[primaryIndex.rangeKey.key] = primaryIndex.rangeKey;
        }

        if (globalSecondaryIndexes) {
          tableParams.GlobalSecondaryIndexes = [];
          globalSecondaryIndexes.forEach(function (index) {
            var projection = {
              ProjectionType: 'ALL'
            };
            var projectionSettings = index.projection;
            if (projectionSettings) {
              projection.ProjectionType = projectionSettings.type;
              if (projectionSettings.nonKeyAttributes) {
                projection.NonKeyAttributes = projectionSettings.nonKeyAttributes;
              }
            }
            if (!projection) {
              projection = {};
              projection.type = 'ALL';
              //projection.nonKeyAttributes = [];
            }
            tableParams.GlobalSecondaryIndexes.push({
              IndexName: index.name,
              KeySchema: [{
                AttributeName: index.hashKey.key,
                KeyType: 'HASH'
              }, {
                AttributeName: index.rangeKey.key,
                KeyType: 'RANGE'
              }],
              Projection: projection,
              ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1
              }
            });

            attributeKeys[index.hashKey.key] = index.hashKey;
            if (attributeKeys.rangeKey) {
              attributeKeys[index.rangeKey.key] = index.rangeKey;
            }
          });
        }

        tableParams.AttributeDefinitions = [];

        Object.keys(attributeKeys).forEach(function (key) {
          tableParams.AttributeDefinitions.push({
            AttributeType: attributeKeys[key].type,
            AttributeName: attributeKeys[key].key
          });
        });

        tableParams.TableName = self.tableName(model);

        self.client.createTable(tableParams, function (err) {
          if (err) {
            modelCallback(err);
          } else {
            modelCallback(null);
          }
        });
      });
    } else {
    modelCallback();
    }
  }, function (err) {
    debug.enabled && debug(err);
    cb(err);
  });
  } else {
    cb();
  }
};

DynamoDB.prototype.disconnect = function () {

};

DynamoDB.prototype.ping = function (cb) {
  debug && debug("Pinging for a list of tables");

  this.client.listTables({}, function(err, data) {
    debug && debug(data);
    if (err) {
      debug.enabled && debug(err);
      cb(err); // an error occurred
    } else{
    cb(err, data);       // successful response
    }
  });

};

/**
 * @private
 * @param {String}  model The name of the model
 *
 * @returns {String[]} Any model properties that are in the primary key of the dynamo db table.  If the model did
 *           not define the primary key keys, then we assume 'id'.
 */
DynamoDB.prototype.getPrimaryKeyProperties = function (model) {
  var primaryKeyProperties = [];
  if (this.dataSource.definitions[model] &&
      this.dataSource.definitions[model].settings.primaryIndex) {

    var primaryKeyDefinition = this.dataSource.definitions[model].settings.primaryIndex;

    primaryKeyDefinition.hashKey.isHash = true;

    primaryKeyProperties.push(primaryKeyDefinition.hashKey);

    if (primaryKeyDefinition.rangeKey) {
      primaryKeyDefinition.rangeKey.isRange = true;
      primaryKeyProperties.push(primaryKeyDefinition.rangeKey);
    }
  } else {
    primaryKeyProperties.push({
      key: this.dataSource.definitions[model].idColumnName() || 'id',
      type: 'S',
      isHash: true
    });
  }

  return primaryKeyProperties;
};

DynamoDB.prototype.getPrimaryKeyValues = function(model, data) {
  var me = this;
  var primaryKeyValues = {};
  var primaryKeyProperties = this.getPrimaryKeyProperties(model);
  primaryKeyProperties.forEach(function (property) {
    primaryKeyValues[property.key] = me.convertId(model, data[property.key], property);
  });
  return primaryKeyValues;
}


DynamoDB.prototype.castDatePropertiesBackToDate = function (model, data) {
  var modelDefinition = this.dataSource.definitions[model],
    properties = modelDefinition.properties,
    property;

  Object.keys(properties).forEach(function (key) {
    property = properties[key];
    if (property && property.type === Date && data && data[key]) {
      data[key] = new Date(data[key]);
    }
  });
};

/**
 *
 * @private
 */
DynamoDB.prototype.isInPrimaryIndex = function (key, model) {
  if (this.dataSource.definitions[model] &&
      this.dataSource.definitions[model].settings.primaryIndex) {
    var primaryKeyDefinition = this.dataSource.definitions[model].settings.primaryIndex;

    return key === primaryKeyDefinition.rangeKey.key || key === primaryKeyDefinition.hashKey.key;
  } else {
    return key === 'id';
  }
};

/**
 *
 * @private
 *
 * More information on where operations:
 * http://docs.strongloop.com/display/public/LB/Where+filter#Wherefilter-Operators
 *
 * Here we are checking to see if this where clause requests an operator that does not work for DynamoDB
 * querying.  This lets us know we have to scan instead.
 *
 */
DynamoDB.prototype.whereCanBeQueried = function (whereObject) {
  var properties = Object.keys(whereObject),
    whereIsQueriable = true;

  properties.forEach(function (conditionKey) {
    var whereValue = whereObject[conditionKey],
      hasNonQueryableAttributes = false;
    //The where definition is a complex and not just an equivalancy operation.
    if (Object.prototype.toString.call(whereValue) == "[object Object]") {
      hasNonQueryableAttributes = !!whereValue.inq ||
                        !!whereValue.and ||
                          !!whereValue.or ||
                            !!whereValue.gt ||
                              !!whereValue.gte ||
                                !!whereValue.lt ||
                                  !!whereValue.lte ||
                                    !!whereValue.between ||
                                      !!whereValue.nin ||
                                        !!whereValue.near ||
                                          !!whereValue.neq ||
                                            !!whereValue.like ||
                                              !!whereValue.nlike;
      if (hasNonQueryableAttributes) {
        whereIsQueriable = false;
      }
    }
  });

  return whereIsQueriable;
};

/**
 * @private
 */
DynamoDB.prototype.addWhereObjectToConditions = function (params, findOperation, whereObject, operator) {
  var properties = Object.keys(whereObject),
    me = this;
  //For each property in the where condition, decide what to add to the query or scan operation.
  properties.forEach(function (conditionKey) {
    var whereValue = whereObject[conditionKey];
    if (conditionKey === "and") {
      whereValue.forEach(function (whereClause) {
        me.addWhereObjectToConditions(params, findOperation, whereClause, 'AND');
      });
    } else if (conditionKey === "or") {
      whereValue.forEach(function (whereClause) {
        me.addWhereObjectToConditions(params, findOperation, whereClause, 'OR');
      });
    } else {
      me.addConditionToParam(params, findOperation, conditionKey, whereValue, operator || "AND");
    }

  });
};

/**
 * @private
 *
 */
DynamoDB.prototype.getIdWhere = function (model, id) {
  var idWhere = {};
  idWhere[this.idKey(model)] = this.convertId(model, id);
  return idWhere;
};

DynamoDB.prototype.convertId = function convertId(model, id, property) {
  if(!property) {
    var properties = this.getPrimaryKeyProperties(model);
    property = properties[0];
    if(!property.isHash) property = properties[1];
  }
  if(property.type == "S") id = String(id);
  else if (property.type == "N") id = Number(id);
  return id;
}

DynamoDB.prototype.convertFilter = function convertFilter(model, filter) {
  var properties = this.getPrimaryKeyProperties(model);
  properties.forEach(function(p) {
    if(filter.where) {
      if(filter.where[p.key]) {
        if(filter.where[p.key].inq) return;
        filter.where[p.key] = this.convertId(model, filter.where[p.key], p);
      }
    } else if(filter[p.key]) filter[p.key] = this.convertId(model, filter[p.key]);
  }.bind(this));
  return filter;
}

// TODO: wrap this functionality in with the main .all implementation
DynamoDB.prototype.range = function (model, id, start, end, callback) {
  var properties = this.getPrimaryKeyProperties(model);
  var hash = properties[0], range = properties[1];
  if(!hash.isHash) hash = properties[1], range = properties[0];
  id = this.convertId(model, id, hash);
  var params = {
    TableName: this.tableName(model),
    Select: "ALL_ATTRIBUTES"
  };
  params.KeyConditions = [
    this.client.Condition(hash.key, "EQ", id),
    this.client.Condition(range.key, "BETWEEN", start, end)
  ];
  this.client.query(params, function(err, data) {
    if(err) callback(err);
    else callback(null, data.Items);
  });
};

/**
 * @private
 *
 * @param {Object}    params           The params to the query or scan DynamoDB operation.
 * @param {String}    operation        "scan" or "query"
 * @param {String}    key            The key in the where clause, either a property of the model, or a logical operator.
 * @param {Object|String|Number|String[]|Number[]} Whatever the value is in the logical operation.
 *
 */
DynamoDB.prototype.addConditionToParam = function (params, operation, key, conditionValue, operator) {
  if (key === "and") {
    throw new Error("And operator not currently supported");
  }

  if (key === "or") {
    throw new Error("Or operator not currently supported");
  }


  //var attributeShorthand = "#" + key;
  var expressionAttributeNames = parameterizePath(key);
  var attributeShorthand = expressionAttributeNames.path;

  //If it is a scan, we have to add expression attributes.
  if (operation === "scan") {

    params.ExpressionAttributeNames = params.ExpressionAttributeNames || {};

    params.ExpressionAttributeValues = params.ExpressionAttributeValues || {};

    //var expressionAttributeName = {};

    //params.ExpressionAttributeNames[attributeShorthand] = key;
    params.ExpressionAttributeNames = expressionAttributeNames.ExpressionAttributeNames;
  }

  function getExpressionValueToken(value) {
    if (!util.isArray(value)) {
      var token = value ? ":" + value.toString().replace(/[^a-zA-Z0-9]/g, "") : ":" + value;

      if (value === "*") {
        token = ":specialStarParamKey";
      }

      if (!params.ExpressionAttributeValues[token]) {
        if (value instanceof Date) {
          params.ExpressionAttributeValues[token] = value / 1;
        } else {
          params.ExpressionAttributeValues[token] = value;
        }
      }
      return token;
    } else {
      var tokens = [];
      value.forEach(function (subValue) {
        tokens.push(getExpressionValueToken(subValue));
      });
      return tokens.join(',');
    }
  }

  //The where definition is a complex and not just an equivalancy operation.
  if (Object.prototype.toString.call(conditionValue) == "[object Object]") {
    var operators = Object.keys(conditionValue);

    if (!params.FilterExpression) {
      params.FilterExpression = "";
    }

    operators.forEach(function (keyValue) {
      if (params.FilterExpression !== "") {
        params.FilterExpression += " " + operator + " ";
      }
      //We are already into a scan situation because queries can't support any of this.
      switch (keyValue) {
      case 'inq':
      params.FilterExpression += "(" + attributeShorthand + " IN (" + getExpressionValueToken(conditionValue.inq) + ")" + ")";
      break;
      case 'gt':
      params.FilterExpression += "(" + attributeShorthand + " > " + getExpressionValueToken(conditionValue.gt) + ")";
      break;
      case 'gte':
      params.FilterExpression += "(" + attributeShorthand + " >= " + getExpressionValueToken(conditionValue.gte) + ")";
      break;
      case 'lt':
      params.FilterExpression += "(" + attributeShorthand + " < " + getExpressionValueToken(conditionValue.lt) + ")";
      break;
      case 'lte':
      params.FilterExpression += "(" + attributeShorthand + " <= " + getExpressionValueToken(conditionValue.lte) + ")";
      break;
      case 'between':
      params.FilterExpression += "(" + attributeShorthand + " BETWEEN " + getExpressionValueToken(conditionValue.between[0]) + " AND " + getExpressionValueToken(conditionValue.between[1]) + ")";
      break;
      case 'nin':
      params.FilterExpression += "NOT " + "(" + attributeShorthand + " IN (" + getExpressionValueToken(conditionValue.nin) + "))"
      break;
      case 'near':
      throw new Error('near is not supported');
      break;
      case 'neq':
      // MOD: for not null condition
      if (conditionValue.neq === null) {
        params.FilterExpression += "(attribute_exists(" + attributeShorthand + "))";
      } else {
        params.FilterExpression += "(" + attributeShorthand + " <> " + getExpressionValueToken(conditionValue.neq) + ")";
      }
      break;
      case 'like':
      params.FilterExpression += "(contains(" + attributeShorthand + "," + getExpressionValueToken(conditionValue.like) + "))";
      break;
      case 'nlike':
      params.FilterExpression += "(NOT contains(" + attributeShorthand + "," + getExpressionValueToken(conditionValue.nlike) + "))";
      break;
      case 'or':
      case 'and':
      throw new Error('and and or conditions are not supported');
      }
    });
  } else {
    //Simple case -- do equivalency in query/scan notation.
    if (operation === 'query') {
      params.KeyConditions = params.KeyConditions || [];
      // MOD: for null condition
      if (conditionValue === null) {
        params.KeyConditions.push(this.client.Condition(key, "NULL"));
      } else {
        params.KeyConditions.push(this.client.Condition(key, "EQ", conditionValue));
      }
    } else {
      // MOD: for null condition
      if (!params.FilterExpression) {
        params.FilterExpression = "";
      } else {
        params.FilterExpression += " " + operator + " ";
      }
      if (conditionValue === null) {
        params.FilterExpression += "attribute_not_exists(" + attributeShorthand + ")";
      } else {
        params.FilterExpression += attributeShorthand + " = " + getExpressionValueToken(conditionValue);
      }
    }
  }
};

function parameterizePath(path) {
  var pieces = path.split(".");
  var ean = {}; //ExpressionAttributeNames
  var parameters = [];
  for(var i = 0; i < pieces.length; i++) {
    var param = "#" + pieces[i];
    ean[param] = pieces[i];
    parameters.push(param);
  }
  var ppath = parameters.join(".");
  return {ExpressionAttributeNames:ean, path: ppath};
}

DynamoDB.prototype.computeExpression = function computeExpression(model, object, projection) {
  var uvalues = {};
  var unames = {};
  var updates = [], removes = [];
  var keyFields = {};
  var hasNames = false;
  this.getPrimaryKeyProperties(model).forEach(function(p) { keyFields[p.key] = true; });
  for(var field in object) {
    if(field in keyFields) continue;
    var value = object[field];
    var path = field;
    if(projection) path = projection + "." + path;
    var param = parameterizePath(path);

    if(value === undefined) {
      removes.push(param.path);
    } else {
      var update = param.path + " = :" + field;
      updates.push(update);
      uvalues[":" + field] = value;
    }
    for(var name in param.ExpressionAttributeNames) {
      unames[name] = param.ExpressionAttributeNames[name];
      hasNames = true;
    }
  }
  var uexp = "";
  if(updates.length)
    uexp += "SET " + updates.join(', ') + " ";
  if(removes.length)
    uexp += "REMOVE " + removes.join(', ') + " ";

  if(!updates.length && !removes.length) return null;

  var params = {
    UpdateExpression: uexp
  };
  if(updates.length > 0)
    params.ExpressionAttributeValues = uvalues;
  if(hasNames)
    params.ExpressionAttributeNames = unames;
  return params;
}

function findTerminals(tree, lambda) {
  switch(tree.type) {
    case "Compound":
      tree.body.forEach(function(child) { findTerminals(child, lambda); });
      break;
    case "BinaryExpression":
      findTerminals(tree.left, lambda);
      findTerminals(tree.right, lambda);
      break;
    case "MemberExpression":
      findTerminals(tree.object, lambda);
      findTerminals(tree.property, lambda);
      break;
    case "UnaryExpression":
      findTerminals(tree.argument, lambda);
      break;
    case "CallExpression":
      tree.arguments.forEach(function(child) { findTerminals(child, lambda); });
      break;
    case "Identifier":
    case "Literal":
      lambda(tree);
      break;
  };
}

DynamoDB.prototype.copyParameters = function copyParameters(source, destination) {
  // copy names
  if(!destination.ExpressionAttributeNames && source.ExpressionAttributeNames)
    destination.ExpressionAttributeNames = {};
  for(var field in source.ExpressionAttributeNames)
    destination.ExpressionAttributeNames[field] = source.ExpressionAttributeNames[field];

  // copy values
  if(!destination.ExpressionAttributeValues && source.ExpressionAttributeValues)
    destination.ExpressionAttributeValues = {};
  for(var field in source.ExpressionAttributeValues)
    destination.ExpressionAttributeValues[field] = source.ExpressionAttributeValues[field];

  ["UpdateExpression", "ConditionExpression", "TableName", "Key", "ReturnValues"].forEach(function(f) {
    if(source[f]) destination[f] = source[f];
  });
  return destination;
}


DynamoDB.prototype.parameterizeExpressions = function parameterizeExpressions() {
  var expressions = [];
  for(var i = 0; i < arguments.length; i++)
    if(arguments[i] != null)
      expressions.push(arguments[i]);
  var values = {}, names = {};
  var vcount = 0, ncount = 0;
  expressions.forEach(function(expression) {
    var tree = parse(expression);
    findTerminals(tree, function(item) {
      if(item.type == "Literal") {
        var replacement = ":val" + vcount++;
        values[replacement] = item.value;
        vcount++;
      } else if(item.type == "Identifier") {
        var replacement = "#" + item.name;
        names[replacement] = item.name;
        ncount++;
      }
    });
  });
  expressions.forEach(function(expression, i) {
    for(var r in names) {
      var rname = names[r];
      var re = new RegExp("\\b" + rname + "\\b", "g");
      expression = expression.replace(re, r);
    }
    for(var r in values) {
      var rvalue = values[r];
      var re;
      if(typeof rvalue == 'string') {
        re = new RegExp("['\"]?\\b" + rvalue + "\\b['\"]?", "g");
      } else {
        re = new RegExp("\\b" + rvalue + "\\b", "g");
      }
      expression = expression.replace(re, r);
    }
    expressions[i] = expression;
  });
  var parameterizations = { expressions : expressions };
  if(ncount)
    parameterizations.ExpressionAttributeNames = names;
  if(vcount)
    parameterizations.ExpressionAttributeValues = values;
  return parameterizations;
};

function merge(base, update) {
  if (!base) {
    return update;
  }
  // We cannot use Object.keys(update) if the update is an instance of the model
  // class as the properties are defined at the ModelClass.prototype level
  for(var key in update) {
    var val = update[key];
    if(typeof val === 'function') {
      continue; // Skip methods
    }
    base[key] = val;
  }
  return base;
}

DynamoDB.prototype.tableName = function (model) {
  var name = this.getDataSource(model).tableName(model);
  var dbName = this.dbName;
  if (typeof dbName === 'function') {
    name = dbName(name);
  }
  return name;
};

/**
 * Initialize the DynamoDB connector for the given data source
 * @param {DataSource} dataSource The data source instance
 * @param {Function} [cb] The callback function
 */
exports.initialize = function initializeDataSource(dataSource, cb) {
  var settings = dataSource.settings || {};

  debug && debug('Initializing dynamo');

  // prepare for loading AWS SDK
  if (settings.region) {
    process.env.AWS_REGION = settings.region;
  }
  if (settings.credentials === 'shared') {
    if (settings.profile) {
      process.env.AWS_PROFILE = settings.profile;
    }
  }

  AWS = require('aws-sdk');
  DOC = require('dynamodb-doc');

  if (!AWS) {
    return;
  }

  var dbConfig = {
    region: process.env.AWS_REGION,
    apiVersion: settings.dynamoApiVersion
  };

  if (settings.credentials === 'file') {
    AWS.config.loadFromPath(settings.credfile);
    //allowing in memory credentials against original repository creator's wishes
  } else if (settings.credentials === 'memory') {
    dbConfig.credentials = settings.inMemoryCredentials;
  }

  AWS.config.apiVersions = {
    dynamodb: 'latest'
  };

  if (settings.endpoint) {
    dbConfig.endpoint = new AWS.Endpoint(settings.endpoint);
  }

  var db = new AWS.DynamoDB(dbConfig),
    client = new DOC.DynamoDB(db);

  debug && debug(settings);
  dataSource.connector = new DynamoDB(client, dataSource);
  dataSource.connector.dataSource = dataSource;

  if (debug) {
    debug && debug("Tables present at initialization:");
    dataSource.connector.ping(function () {});
  }

  if (cb) {
    dataSource.connector.connect(cb);
  }
};
