var request = require('request');
var google = require('googleapis');
var manager = google.deploymentmanager('v2');
var monitoring = google.monitoring('v3');
var cloudresourcemanager = google.cloudresourcemanager('v1');
var yaml = require('yamljs');
var url = require('url');
var Metrics = require('./metrics');
var GoogleChart = require('./googlechart');
var ScriptRunner = require('./scripts');
var Utils = require('./utils');

function GCPClient(authCache, user, userData, teamId, replier) {
  this.user = user;
  this.userData = userData;
  this.teamId = teamId;
  this.authCache = authCache;
  this.replier = replier;
}

/**
 * Save the current auth tokens, if they have changed.
 */
GCPClient.prototype.updateAuth = function() {
  var auth = this.auth;
  // If the access token has changed, update the credentials. (This happens automatically after requests)
  if(auth.tokens.access_token != auth.client.credentials.access_token) {
    auth.tokens = auth.client.credentials;
    this.authCache.saveAuth(auth);
  }
};

/**
 * Authorize with Google Cloud platform using this object's auth info.
 * @returns {Promise} - a promise that is fulfilled when authorization is complete or rejected if the user is not authorized yet. (A message with the auth url is sent)
 */
GCPClient.prototype.authorize = function() {
  var self = this;
  var replier = this.replier;
  return self.authCache.lookupAuth(self.user).then(function(auth) {
    if(auth.client && auth.client.credentials && auth.client.credentials.access_token) {
      self.auth = auth;
      return auth;
    }
    if(!auth.client) {
      self.authCache.createAuth(self.user, self.teamId).then(function(auth) {
        self.auth = auth;
        return self.authCache.generateAuthUrl(self.user, self.teamId).then(function(url) {
          var message = {
            "text": "🔑 Log into your Google Cloud Platform account <" + url + "|by following this link> to give me access :wink:",
            "mrkdwn": true
          };
          replier(message, true);
        });
      });
    }
    replier("🔑 Before I can help you, you need to give me authorization to use your Google Cloud Platform account. I sent you a direct message with the link.");
    return null;
  });
};

/**
 * Shows the detail for a specific deployment, including resources.
 * 
 * @param {string} deployId - the id of the deployment to show detail for
 */
GCPClient.prototype.showDeployDetail = function(deployId) {
  this.replier("Deployment detail for deployment " + deployId);
  return checkDeploy(this, deployId);
};

/**
 * Shows a list of all deployments in the project
 */
GCPClient.prototype.showDeployList = function() {
  var client = this;
  client.replier("Deployment list: ");
  return listDeployments(client).catch(function(err) {
    client.replier("🚫 There was an error listing deployments.");
  });
};

/**
 * Shows a summary of the deploys associated with a certain email address
 * 
 * @param {string} email - the email address to search by
 */
GCPClient.prototype.showDeploySummary = function(email) {
  var client = this;
  client.replier("Deployment summary for " + email);
  var filterStr = 'operation.user eq ' + email;
  return listDeployments(client, filterStr).catch(function(err) {
    client.replier("🚫 There was an error listing deployments.");
  });
};

/**
 * Creates a new deploy from a specified yaml file in a github repo.
 * 
 * @param {string} repo - the github repo to look in
 * @param {string} depFile - the name of the config file (without extension)
 */
GCPClient.prototype.newDeploy = function(repo, depFile) {
  var client = this;
  var yamlName = depFile + ".yaml";
  var ghPref = 'https://github.com/';
  var rawMaster = '/raw/master/';
  var baseURL = ghPref + repo + rawMaster;

  return fetchConfiguration(baseURL, yamlName).then(function(result) {
    var configString = result.body;
    if (!configString) {
      client.replier("yaml file not found: " + url.resolve(baseURL, yamlName));
      return;
    }
    
    var insert = insertDeployment(client, depFile, configString, result.imports);
    insert.catch(function(errors) {
      for(i = 0; i < errors.length; i++) {
        client.replier('🚫 ' + errors[i]);
      }
    });
    return insert;
  });
};

/**
 * Retrieve a list of metrics with an optional array of filter strings. The filter works by matching
 * any metric that contains ALL the provided strings.
 * 
 * @param {string[]} metricFilters - an array of Strings that filters the metrics to only ones that contain ALL of the Strings
 */
GCPClient.prototype.getMetrics = function(metricFilters) {
  var client = this;
  var query = '';
  if (metricFilters) {
    query = 'metric.type : "' + metricFilters.join('" AND metric.type : "') + '"';
  }
  
  return new Promise(function(fulfill, reject) {
    monitoring.projects.metricDescriptors.list({
      auth: client.auth.client,
      name: 'projects/' + client.userData.projectId,
      filter: query },
      function(err, resp) {
        client.updateAuth();
        if(err) {
          console.log('monitoring.projects.metricDescriptors', err);
          reject(err);
          return;
        }

        console.log("metrics:", resp.metricDescriptors.length, "query:", query);
        fulfill(resp.metricDescriptors);
      }
    );
  });
};

/**
 * Show a list of metrics with an optional array of filter strings. The filter works by matching
 * any metric that contains ALL the provided strings. Metrics will be truncated at 50.
 * 
 * @param {string[]} metricFilters - an array of Strings that filters the metrics to only ones that contain ALL of the Strings
 */
GCPClient.prototype.listMetrics = function(metricFilters) {
  var client = this;
  return this.getMetrics(metricFilters).then(function(metrics) {
    var limit = Math.min(50, metrics.length);
    var responseMessage = limit >= metrics.length ? (metrics.length + " metrics:") : limit + ' of ' + metrics.length + ' metrics. Filter the results to find what you are looking for.';
    for(i = 0; i < limit; i++) {
      responseMessage += "\n `" + metrics[i].type + "` - " + metrics[i].description;
    }
    client.replier(responseMessage);
    return metrics;
  });
};

/**
 * Reply with the results of monitoring a list of metrics.
 * 
 * @param {string[]} metrics - a list of GCP metrics that should be monitored. e.g. "compute.googleapis.com/instance/cpu/utilization"
 * @param {string} instance - the instance to filter to
 */
GCPClient.prototype.monitorMetricList = function(metrics, instance) {
  return monitorMetrics(this, metrics, instance);
};

/**
 * Reply with the results of monitoring a list of metrics from a predefined pack.
 * 
 * @param {string} packName - the name of a predefined list of metrics e.g. "cpu", "simple"
 */
GCPClient.prototype.monitorMetricPack = function(packName, instance) {
  if (Metrics.packages[packName]) {
    var metrics = Metrics.packages[packName].metrics;
    return this.monitorMetricList(metrics, instance);
  } else {
    return new Promise.resolve([]);
  }
};

/**
 * Return a list of projects for a user 
 */
GCPClient.prototype.getProjects = function() {
  var client = this;
  return new Promise(function(fulfill, reject) {
    cloudresourcemanager.projects.list({
      auth: client.auth.client },
      function(err, resp) {
        client.updateAuth();
        if(err) {
          console.log('cloudresourcemanager.projects.list', err);
          reject(err);
          return;
        }
        fulfill(resp.projects);
      }
    );
  });
};

GCPClient.prototype.runScript = function(script) {
  var client = this;
  return new Promise(function(fulfill, reject) {
    var gcloud = require('gcloud')({
      projectId: client.userData.projectId
    });
    gcloud = wrapForAuth(gcloud, client.auth.client);
    var callback = function(err, results) {
      if(err) {
        reject(err);
      } else {
        fulfill(results);
      }
    };
    var runner = new ScriptRunner(script, {}, [gcloud, callback]);
    runner.run();
  });
};

// TODO: try to be less invasive than this?
function wrapForAuth(gcloud, authClient) {
  var auth = {
    getAuthClient: function(cb) {
      return cb(null, authClient); 
    }
  };
  function buildFunction(value) {
    var func = function() {
      var result = value.call(gcloud, arguments);
      result.authClient = auth;
      return result;
    };
    func.prototype = value.prototype;
    return func;
  }
  for(var attr in gcloud) {
    var value = gcloud[attr];
    if(typeof value === 'function') {
      gcloud[attr] = buildFunction(value);
    }
  }
  return gcloud;
}

function emojiForStatus(status) {
  if (status == "PENDING") {
    return "✋";
  } else if (status == "RUNNING") {
    return "🏃";
  } else if (status == "DONE" || status == "COMPLETE") {
    return "✅";
  }
}

function fetchConfiguration(baseURL, yamlName) {
  return new Promise(function(fulfill, reject) {
    //get the file, use it as the resource info supplied to the insert cmd in gcp
    var configString = "";
    var files = [{ path: yamlName }];
    
    fetchNextFile(files, baseURL, true, function(body, imports, errors) {
      if(errors && errors.length > 0) {
        reject(errors);
      } else {
        fulfill({
          body: body,
          imports: imports
        });
      }
    });
  });
}

function fetchNextFile(files, baseURL, isConfig, callback) {
  var file = files.shift();
  // The recursion terminating case
  if (!file) {
    callback(null, [], []);
    return;
  }
  
  var fileImports = [];
  var errors = [];
  var fileURL = url.resolve(baseURL, file.path);
  console.log('fetching', isConfig ? 'config' : 'template', fileURL);

  request(fileURL, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var yamlContent = yaml.parse(body);
      files = files.concat(yamlContent.imports);
      if (!isConfig) {
        fileImports.push({
          name: file.path,
          content: body
        });
      }
    } else {
      body = null;
      var errorMsg = error || (response.statusCode + ' response status');
      errors.push(errorMsg + ' for ' + fileURL );
    }
    
    // Trigger the call for the next file (also handles empty case..)
    // Build up the imports and errors list by combining in the callback.
    fetchNextFile(files, baseURL, false, function (nextBody, nextImports, nextErrors) {
      callback(body, fileImports.concat(nextImports), errors.concat(nextErrors));
    });
  });
}

function sendDeployDetailReplies(client, deploy, includeProgressLink) {
  var statusIcon = emojiForStatus(deploy.operation.status);
  var replyMessage = statusIcon + " Deploy *" +
    deploy.name + "* Status: " + deploy.operation.status +
    "\n*Started at*: " + deploy.operation.startTime;
  if (deploy.operation.endTime) {
    replyMessage += " *Completed at*: " + deploy.operation.endTime;
  }
  replyMessage += " by " + deploy.operation.user;
  if (includeProgressLink) {
    replyMessage += "\n" + deploy.operation.progress + "% complete. To view progress, navigate to " +
      " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID;
  }
  client.replier(replyMessage);
  
  // print out the errors if the deployed is complete and had errors
  if ( deploy.operation.error && (deploy.operation.status == "DONE" || deploy.operation.status == "COMPLETE") ) {
    var errors = deploy.operation.error.errors;
    for ( var errorNum in errors ) {
      var error = errors[errorNum];
      client.replier("🚫 *Error*: " + error.code + " *location*: " + error.location + " *message*: " + error.message);
    }
  }
}

function listResources(client, depName) {
  return new Promise(function (fulfill, reject) {
    var params = {
      auth: client.auth.client,
      project: client.userData.projectId,
      deployment: depName
    };
    manager.resources.list(params, function(err, resp) {
      if(err) {
        console.log('manager.resources.list', err);
        reject(err);
        return;
      }
      client.updateAuth();
      if(!resp.resources) {
        client.replier("No resourses.");
      } else {
        //for each resource, check status of machine - if there's an error - check logs
        resList = resp.resources;
        client.replier("Deploy *" + depName + "* resource summary:");

        for ( var i = 0; i < resList.length; i++ ) {
          var resName = resList[i].name;
          var resType = resList[i].type;

          //get the yaml for the properties, and pull out some interesting info
          var propObj = {};
          if (resList[i].finalProperties) {
            propObj = yaml.parse(resList[i].finalProperties);
          }
          client.replier("📋 Resource #" + i + ":");
          client.replier("*Name:* " + resName +
            "\n*Type:* " + resType +
            "\n*Machine Class:* " + propObj.machineType +
            "\n*Zone:* " + propObj.zone );
        }
      }
      fulfill();
    });
  });
}

function checkDeploy(client, depName) {
  var status = "";
  var filterStr = 'name eq ' + depName;

  return new Promise(function (fulfill, reject) {
    var params = {
      auth: client.auth.client,
      project: client.userData.projectId,
      filter: filterStr 
    };
    manager.deployments.list(params, function(err, resp) {
      if(err) {
        reject(err);
        return;
      }
      client.updateAuth();

      if(!resp.deployments) {
        client.replier("No deployment found");
        fulfill();
        return;
      }
      var currDeploy = resp.deployments[0];
      sendDeployDetailReplies(client, resp.deployments[0], false);

      if(currDeploy.operation.status != "DONE" && currDeploy.operation.status != "COMPLETE") {
        // Fulfill with another promise to check it again in 2 seconds.
        setTimeout(function() {
          fulfill(checkDeploy(client, depName));
        }, 2000);
      } else {
        //now get the resources based on the dep name
        fulfill(listResources(client, depName));
      }
    });
  });
}

function outputMetricsData(client, metrics, responseData) {
  var hasData = false;
  var count = 0;
  for (var metric in responseData) {
    var charts = [];
    var chart = null;
    
    var timeSeries = responseData[metric];
    for (var i = 0; i < timeSeries.length; i++) {
      // Allow 4 series per chart
      if(i % 4 === 0) {
        chart = new GoogleChart(400, 200);
        charts.push(chart);
      }
      hasData = true;
      var instanceData = timeSeries[i];
      if (instanceData) {
        var values = [];
        var points = instanceData.points;
        if (points && points.length > 0) {
          var newestPoint = points[0];
          var oldestPoint = points[points.length-1];
          var newestValue = getTimeSeriesValue(newestPoint);
          for( j = 0; j < points.length; j++ ) {
              value = getTimeSeriesValue(points[j]);
              values.push(value);
          }
          
          var startTime = Utils.formatDate(new Date(oldestPoint.interval.startTime));
          var endTime = Utils.formatDate(new Date(newestPoint.interval.endTime));
          
          var instanceName = 'Some instance';
          if(instanceData.metric.labels && instanceData.metric.labels.instance_name) {
            instanceName = instanceData.metric.labels.instance_name;
          }
          chart.addData(values, instanceName, startTime, endTime);
        }
      }
    }
    var attachments = [];
    for(var c in charts) {
      chart = charts[c];
      var imageUrl = chart.buildUrl();
      var attachment = {
        'title': metric,
        'color': 'good'
      };
      if(imageUrl.length <= 2000) {
        attachment.image_url = imageUrl;
        attachment.title_link = imageUrl;
        attachment.fallback = '[chart for ' + metric + ']';
      } else {
        // TODO: do something smarter than this.
        attachment.text = 'Chart has too much data. (Sorry)';
        console.log('URL is too long: ', imageUrl);
      }
      attachments.push(attachment);
    }
    if(attachments.length > 0) {
      client.replier({
        'attachments': attachments
      });
    } else {
      client.replier('No data for ' + metric);
    }
  }
  
  if (!hasData) {
    client.replier('No monitor data returned.');
  }
}

function monitorSeries(client, metricType, instance, callback) {
  var startDate = new Date();
  var endDate = new Date();
  startDate.setDate(startDate.getDate() - 1);
  
  var filter = 'metric.type = "' + metricType + '"';
  if(instance) {
    filter += ' AND metric.label.instance_name = "' + instance + '"';
  }
  console.log('filter:', filter, 'instance:', instance);
  
  client.getMetrics([metricType]).then(function(metrics) {
    var alignment = 'ALIGN_MAX';
    if(metrics && metrics.length > 0) {
      var metric = metrics[0];
      alignment = Metrics.alignmentMapping(metric.metricKind, metric.valueType);
    }
    console.log('using alignment:', alignment, 'for metric:', metricType);
    
    var params = {
      auth: client.auth.client,
      name: 'projects/' + client.userData.projectId,
      filter: filter,
      'interval.startTime': startDate.toJSON(),
      'interval.endTime': endDate.toJSON(),
      'aggregation.perSeriesAligner': alignment,
      'aggregation.alignmentPeriod': Utils.calculateIntervalLength(startDate, endDate, 80) + 's'
    };
    monitoring.projects.timeSeries.list(params, function( err, resp ) {
      if (err) {
        console.log('monitoring.projects.timeSeries.list. metric:', metricType, 'error:', err);
        callback(metricType, null, err);
        return;
      } else {
        client.updateAuth();
        callback(metricType, resp.timeSeries);
      }
    });
  });
  
}

function getTimeSeriesValue(point) {
  if (point.value.doubleValue) {
    return parseFloat(point.value.doubleValue);
  } else if (point.value.int64Value) {
    return parseInt(point.value.int64Value);
  }
  return;
}

function listDeployments(client, filterStr) {
  var params = {
    auth: client.auth.client,
    project: client.userData.projectId
  };
  if (filterStr) {
    params.filter = filterStr;
  }
  
  return new Promise(function(fulfill, reject) {
    manager.deployments.list(params, function(err, resp) {
      if(err) {
        reject(err);
        return;
      }
      client.updateAuth();

      if(!resp.deployments) {
        client.replier("No deployments to report on.");
        fulfill();
        return;
      }
      
      var deployTotalCount = resp.deployments.length;
      var activeDeploys = [];
      var deadDeploys = [];

      for (i = 0; i < resp.deployments.length; i++) {
        if( resp.deployments[i].operation.status != 'DONE' ) {
          activeDeploys.push( resp.deployments[i] );
        } else {
          deadDeploys.push( resp.deployments[i] );
        }
      }

      client.replier("Deployments *Total Count*: " + deployTotalCount + " *Active*: " + activeDeploys.length);
      for(i = 0; i < activeDeploys.length; i++) {
        sendDeployDetailReplies(client, activeDeploys[i], true);
      }
      for(i = 0; i < deadDeploys.length; i++) {
        sendDeployDetailReplies(client, deadDeploys[i], false);
      }
      fulfill();
    });
  });
}

function monitorMetrics(client, metrics, instance) {
  return new Promise(function(fulfill, reject) {
    var responseData = {};
    var metricsComplete = 0;
    var done = false;
    
    var monitorCallback = function(metric, timeSeries, error) {
      if(done) { return; }
      if(error) {
        client.replier('Sorry, GCP gave me this error: `' + error.message + '`');
        done = true;
        reject();
      }
      if (timeSeries) {
        responseData[metric] = timeSeries;
      }
      metricsComplete++;
      if (metricsComplete == metrics.length) {
        outputMetricsData(client, metrics, responseData);
        done = true;
        fulfill();
      }
    };
    
    for (var i in metrics) {
      var metric = metrics[i];
      responseData[metric] = [];
      monitorSeries(client, metric, instance, monitorCallback);
    }
  });
}

function insertDeployment(client, depFile, configString, imports) {
  return new Promise(function(fulfill, reject) {
    var depName = depFile + Math.floor(new Date() / 1000);
    // Now insert the dependency
    var params = {
      auth: client.auth.client,
      project: client.userData.projectId,
      resource: {
        name: depName,
        target: {
          config: {
            content: configString
          },
          imports: imports
        }
      }
    };
    manager.deployments.insert(params, function(err, resp) {
      client.updateAuth();
      if(err) {
        reject(err);
      } else {
        fulfill(checkDeploy(client, depName));
      }
    });
  });
}

module.exports = GCPClient;
