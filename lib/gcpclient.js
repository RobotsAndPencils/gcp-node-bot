var request = require('request');
var google = require('googleapis');
var manager = google.deploymentmanager('v2');
var monitoring = google.monitoring('v3');
var yaml = require('yamljs');
var url = require('url');
var Metrics = require('./metrics');
var GoogleChart = require('./googlechart');
var Utils = require('./utils');

function GCPClient(jwtClient, replier) {
  this.jwtClient = jwtClient;
  this.replier = replier;
}

/**
 * Authorize with Google Cloud platform using this object's jwtClient.
 * @returns {Promise} - a promise that is fulfilled when authorization is complete
 */
GCPClient.prototype.authorize = function() {
  var jwtClient = this.jwtClient;
  return new Promise(function(fulfill, reject) {
    jwtClient.authorize(function(err, tokens) {
      if(err) {
        console.log('error authorizing user: ', err); 
        reject(err);
      }
      fulfill(tokens);
    });
  });
};

/**
 * Shows the detail for a specific deployment, including resources.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string} deployId - the id of the deployment to show detail for
 */
GCPClient.prototype.showDeployDetail = function(userData, deployId) {
  var client = this;
  return this.authorize().then(function(tokens) {
    client.replier("Deployment detail for deployment " + deployId);
    return checkDeploy(userData, client, deployId);
  });
};

/**
 * Shows a list of all deployments in the project
 * 
 * @param {object} userData - an object containing the projectId and region to use
 */
GCPClient.prototype.showDeployList = function(userData) {
  var client = this;
  this.authorize().then(function(result) {
    client.replier("Deployment list: ");
    return listDeployments(userData, client);
  }, function(err) {
    client.replier("🚫 There was an error listing deployments.");
  });
};

/**
 * Shows a summary of the deploys associated with a certain email address
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string} email - the email address to search by
 */
GCPClient.prototype.showDeploySummary = function(userData, email) {
  var client = this;
  this.authorize().then(function(tokens) {
    client.replier("Deployment summary for " + email);
    var filterStr = 'operation.user eq ' + email;
    return listDeployments(userData, client, filterStr);
  }, function(err) {
    client.replier("🚫 There was an error listing deployments.");
  });
};

/**
 * Creates a new deploy from a specified yaml file in a github repo.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string} repo - the github repo to look in
 * @param {string} depFile - the name of the config file (without extension)
 */
GCPClient.prototype.newDeploy = function(userData, repo, depFile) {
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
    
    var authorization = client.authorize();
    authorization.then(insertDeployment(client, userData, depFile, configString, result.imports));
    authorization.catch(function(errors) {
      for(i = 0; i < errors.length; i++) {
        client.replier('🚫 ' + errors[i]);
      }
    });
    return authorization;
  });
};

/**
 * Show a list of metrics with an optional array of filter strings. The filter works by matching
 * any metric that contains ALL the provided strings. Metrics will be truncated at 50.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string[]} metricFilters - an array of Strings that filters the metrics to only ones that contain ALL of the Strings
 */
GCPClient.prototype.listMetrics = function(userData, metricFilters) {
  var client = this;
  var query = '';
  if (metricFilters) {
    query = 'metric.type : "' + metricFilters.join('" AND metric.type : "') + '"';
  }
  
  this.authorize().then(function(tokens) {
    monitoring.projects.metricDescriptors.list({
      auth: client.jwtClient,
      name: 'projects/' + userData.projectId,
      filter: query },
      function(err, resp) {
        if(err) {
          console.log('monitoring.projects.metricDescriptors', err);
          reject(err);
          return;
        }

        var metrics = resp.metricDescriptors;
        console.log("metrics:", metrics.length, "query:", query);

        var limit = Math.min(50, metrics.length);
        var responseMessage = limit >= metrics.length ? (metrics.length + " metrics:") : limit + ' of ' + metrics.length + ' metrics. Filter the results to find what you are looking for.';
        for(i = 0; i < limit; i++) {
          responseMessage += "\n `" + metrics[i].type + "` - " + metrics[i].description;
        }
        client.replier(responseMessage);
      }
    );
  });
};

/**
 * Reply with the results of monitoring a list of metrics.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string[]} metrics - a list of GCP metrics that should be monitored. e.g. "compute.googleapis.com/instance/cpu/utilization"
 * @param {string} instance - the instance to filter to
 */
GCPClient.prototype.monitorMetricList = function(userData, metrics, instance) {
  var client = this;
  return this.authorize().then(function(tokens) {
    return monitorMetrics(userData, client, metrics, instance);
  });
};

/**
 * Reply with the results of monitoring a list of metrics from a predefined pack.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {string} packName - the name of a predefined list of metrics e.g. "cpu", "simple"
 */
GCPClient.prototype.monitorMetricPack = function(userData, packName, instance) {
  if (Metrics.packages[packName]) {
    var metrics = Metrics.packages[packName].metrics;
    return this.monitorMetricList(userData, metrics, instance);
  } else {
    return new Promise.resolve([]);
  }
};

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

function listResources(userData, client, depName) {
  return new Promise(function (fulfill, reject) {
    var params = {
      auth: client.jwtClient,
      project: userData.projectId,
      deployment: depName
    };
    manager.resources.list(params, function(err, resp) {
      if(err) {
        console.log('manager.resources.list', err);
        reject(err);
        return;
      }
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

function checkDeploy(userData, client, depName) {
  var status = "";
  var filterStr = 'name eq ' + depName;

  return new Promise(function (fulfill, reject) {
    var params = {
      auth: client.jwtClient,
      project: userData.projectId,
      filter: filterStr 
    };
    manager.deployments.list(params, function(err, resp) {
      if(err) {
        reject(err);
        return;
      }

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
          fulfill(checkDeploy(userData, client, depName));
        }, 2000);
      } else {
        //now get the resources based on the dep name
        fulfill(listResources(userData, client, depName));
      }
    });
  });
}

function outputMetricsData(client, metrics, responseData) {
  var hasData = false;
  var count = 0;
  for (var metric in responseData) {
    var metricMessage = '*' + metric + '*';
    var chart = new GoogleChart(400, 200);
    
    var timeSeries = responseData[metric];
    for (var i = 0; i < timeSeries.length; i++) {
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
          
          chart.addData(values, instanceData.metric.labels.instance_name, startTime, endTime);
        }
      } else {
        attachment.text = 'No data\n';
        attachment.color = 'warning';
      }
    }
    
    var attachment = {
      'title': metric,
      'color': 'good'
    };
    var imageUrl = chart.buildUrl();
    attachment.image_url = imageUrl;
    attachment.title_link = imageUrl;
    attachment.fallback = 'this is a fallback...';
    
    client.replier({
      'attachments': [attachment]
    }); 
  }
  
  if (!hasData) {
    client.replier('No monitor data returned.');
  }
}

function monitorSeries(userData, client, metric, instance, callback) {
  var startDate = new Date();
  var endDate = new Date();
  startDate.setDate(startDate.getDate() - 1);
  
  var filter = 'metric.type = "' + metric + '"';
  if(instance) {
    filter += ' AND metric.label.instance_name = "' + instance + '"';
  }
  console.log('filter:', filter, 'instance:', instance);
  var params = {
    auth: client.jwtClient,
    name: 'projects/' + userData.projectId,
    filter: filter,
    'interval.startTime': startDate.toJSON(),
    'interval.endTime': endDate.toJSON(),
    'aggregation.perSeriesAligner': Metrics.alignments[metric] || 'ALIGN_MAX',
    'aggregation.alignmentPeriod': Utils.calculateIntervalLength(startDate, endDate, 80) + 's'
  };
  monitoring.projects.timeSeries.list(params, function( err, resp ) {
    if (err) {
      console.log('monitoring.projects.timeSeries.list', err);
      callback(metric, null, err);
      return;
    }
    callback(metric, resp.timeSeries);
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

function listDeployments(userData, client, filterStr) {
  var params = {
    auth: client.jwtClient,
    project: userData.projectId
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

      if(!resp.deployments) {
        client.replier("No deployments to report on.");
        fulfil();
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

function monitorMetrics(userData, client, metrics, instance) {
  return new Promise(function(fulfill, reject) {
    var responseData = {};
    var metricsComplete = 0;
    
    var monitorCallback = function(metric, timeSeries, error) {
      if (error) {
        client.replier(error.message);
      }
      if (timeSeries) {
        responseData[metric] = timeSeries;
      }
      metricsComplete++;
      if (metricsComplete == metrics.length) {
        outputMetricsData(client, metrics, responseData);
        fulfill();
      }
    };
    
    for (var i in metrics) {
      var metric = metrics[i];
      responseData[metric] = [];
      monitorSeries(userData, client, metric, instance, monitorCallback);
    }
  });
}

function insertDeployment(client, userData, depFile, configString, imports) {
  return new Promise(function(fulfill, reject) {
    var depName = depFile + Math.floor(new Date() / 1000);
    // Now insert the dependency
    var params = {
      auth: client.jwtClient,
      project: userData.projectId,
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
      if(err) {
        reject(err);
      } else {
        fulfill(checkDeploy(userData, client, depName));
      }
    });
  });
}

module.exports = GCPClient;
