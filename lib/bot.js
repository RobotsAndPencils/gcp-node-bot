var BeepBoop = require('beepboop-botkit');
var CronJob = require('cron').CronJob;
var GCPClient = require('./gcpclient');
var Metrics = require('./metrics');
var Scheduler = require('./scheduler');
var Utils = require('./utils');
var yaml = require('yamljs');

var bots = {}; 
 
function sayOrReply(bot, user, message, channel, parentMessage, private) {
  if(typeof message == "string") {
    message = { text: message };
  }
  // Required to add image attachments
  message.as_user = true;
  if(message.mrkdwn) {
    message.username = bot.identity.name;
    message.icon_url = bot.config.icon_url;
  }
  
  if(private) {
    bot.api.im.open({user: user}, function(err, response) {
      if(err) { console.error(err); }
      message.channel = response.channel.id;
      bot.say(message);
    });
  } else if(parentMessage) {
    bot.reply(parentMessage, message);
  } else {
    message.channel = channel;
    bot.say(message);
  }
}

function replier(bot, message) {
  this.bot = bot;
  return function(reply, private) {
    sayOrReply(bot, message.user, reply, null, message, private);
  };
}

function sayer(bot, user, channel) {
  return function(message, private) {
    sayOrReply(bot, user, message, channel, null, private);
  };
}

function parseMetricsFromMessage(metricString) {
  if (metricString) {
      var metrics = metricString.trim().split(' ');
      // Pull metric out of the Slack link syntax (because it looks like a URL)
      for (i = 0; i < metrics.length; i++) {
        var metric = metrics[i];
        var result = /<.*\|(.*)>/.exec(metric);
        if (result) {
          metrics[i] = result[1] || metric;
        }
      }
      return metrics;
  }
  return null;
}

function findProject(searchText, projects) {
  var found = projects.find(function(project) {
    return project.name == searchText || project.projectId == searchText;
  });
  return (found && found.projectId) ? found : null;
}

function buildProjectList(projects) {
  var projectText = projects.length == 1 ? ' project:' : ' projects:';
  var responseMessage = 'You have ' +  projects.length + projectText;
  for(i = 0; i < projects.length; i++) {
    responseMessage += '\n🏷 *' + projects[i].name + '* | ' + projects[i].projectId;
  }
  return responseMessage;
}

function setProject(botData, bot, message, projectId) {
  var data = {
    projectId: projectId
  };
  botData.saveUserChannelData(message.user, message.channel, data);
  bot.reply(message, 'Ok, using project `' + projectId + '` in this channel');  
}

function checkForProject(gcpClient) {
  return new Promise(function(fulfill, reject) {
    var userData = gcpClient.userData;
    if(!userData.projectId) { 
      gcpClient.replier('You need to tell me what project to use first. Use `project` to see a list of projects and choose one.');
    } else {
      fulfill(gcpClient);
    }
  });
}

function catchAll(err) { 
  if(err) {
    console.error(err);
  } 
}

function noop(error) { }

function Bot(controller, botData, authCache, slackToken) {
  this.scheduler = new Scheduler();
  this.botData = botData;
  this.authCache = authCache;
  this.connect(controller, slackToken);
  this.setupActions(controller);
  this.scheduleExistingDigests();
}

Bot.prototype.getBots = function() {
  return bots;
};

Bot.prototype.setupActions = function(controller) {
  var mentionsAndDMs = ['direct_message', 'mention', 'direct_mention'];
  var gcpBot = this;
  controller.hears('help', mentionsAndDMs, function(bot, message) {
    var packs = '`' + Metrics.getPackageList().join('`, `') + '`';
    var botName = message.event != 'direct_message' ? '@' + bot.identity.name + ' ' : '';
    var help = 'I will respond to the following messages: \n' +
        '`' + botName + 'schedule <projectId> <schedule>` to schedule a digest. Schedule is specified with cron syntax. Leave blank to schedule for 9am every morning.\n' +
        '`' + botName + 'schedule` to start scheduling a digest.\n' +
        '`' + botName + 'unschedule` to cancel a scheduled digest in this channel.\n' +
        '`' + botName + 'digest` to show the currently scheduled digest now.\n' +
        '`' + botName + 'project` to list all your projects. Also prompts you to select the project after listing, which any `deploy` and `monitor` commands in this channel will use.\n' +
        '`' + botName + 'project <projectId>` to select a project to use for the other commands in this channel. This is a per user setting. You can change it at any time.\n' +
        '`' + botName + 'deploy list` for a list of all deployment manager jobs and their status.\n' +
        '`' + botName + 'deploy summary <email>` for a list of all deployment manager jobs initiated by the provided user and their status.\n' +
        '`' + botName + 'deploy new <repo> <depfile>` to create a new deployment using a yaml file in the github repo identified with a yaml file called <depfile>.yaml.\n' +
        '`' + botName + 'deploy detail <depname>` to show info and status for a given deployment manager job.\n' +
        '`' + botName + 'monitor metrics <filter...>` to list all metrics. Add one or more strings to filter the results (space-separated list, results match ALL strings).\n' +
        '`' + botName + 'monitor pack <pack name>` to show the values for a named group of metrics. Available packs: ' + packs + '.\n' +
        '`' + botName + 'monitor <metrics...>` to show the values for a set of metrics (space-separated list).\n' +
        '`' + botName + 'help` to see this again.';
    bot.reply(message, help);
  });
  
  controller.on('bot_channel_join', function(bot, message) {
    bot.reply(message, "I'm here! Type `gpcbot help` to see what I can do.");
  });

  controller.hears(['script'], mentionsAndDMs, function(bot, message) {
    var messageText = message.text.trim();
    var matches = messageText.match(/(?:`+)([^`]*)(?:`+)/);
    var script = matches[1];
    // Slack likes to change your quotes :(
    script = script.replace('“', '"').replace('”', '"').replace("‘", "'").replace("’", "'");
    gcpBot.runScript(bot, message, script);
  });

  controller.hears(['project(\\s.*)?'], mentionsAndDMs, function(bot, message) {
    var projectId = message.match[1];
    if(projectId) {
      gcpBot.setProjectFromList(bot, message, projectId.trim());
    } else {
      gcpBot.listProjects(bot, message);
    }
  });

  controller.hears(['schedule (\\S+)(.*)?'], mentionsAndDMs, function(bot, message) {
    var projectId = message.match[1].trim();
    var scheduleString = (message.match[2] || '0 9 * * *').trim(); // Default to every day at 9AM
    console.log('projectId:', projectId, 'scheduleString:', scheduleString);
    gcpBot.schedule(bot, message, projectId, scheduleString);
  });

  controller.hears(['unschedule'], mentionsAndDMs, function(bot, message) {
    gcpBot.unschedule(bot, message);
  });

  controller.hears(['schedule'], mentionsAndDMs, function(bot, message) {
    var projectId = null;
    var scheduleString = null;
    var metricPack = null;
    var checkDone = function(convo) {
      if(projectId && scheduleString && metricPack) {
        gcpBot.schedule(bot, message, projectId, scheduleString, metricPack);
        convo.stop();
      }
    };
    
    // start a conversation to setup a schedule, ask questions in order
    bot.startConversation(message, function(err, convo) {
      convo.ask('Which project would you like to schedule a digest for?', function(response, convo) {
        projectId = response.text;
        checkDone(convo);
        convo.next();
      });
      convo.ask('What cron schedule should the digest run on?', function(response, convo) {
        scheduleString = response.text;
        checkDone(convo);
        convo.next();
      });
      var metricPackages = '`' + Metrics.getPackageList().join('`, `') + '`';
      convo.ask('Which metric pack would you like to use? One of: ' + metricPackages, function(response, convo) {
        metricPack = response.text;
        checkDone(convo);
        convo.next();
      });
    });
  });

  controller.hears(['digest'], mentionsAndDMs, function(bot, message) {
    gcpBot.showDigest(bot, message);
  });

  controller.hears(['d(eploy)? detail (.*)'], mentionsAndDMs, function(bot, message) {
    var depId = message.match[2].trim();
    gcpBot.showDeployDetail(bot, message, depId);
  });

  controller.hears(['d(eploy)? summary (.*)'], mentionsAndDMs, function(bot, message) {
    var user = message.match[2].trim();
    var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
    console.log(email);
    gcpBot.showDeploySummary(bot, message, email);
  });

  controller.hears(['deploy list'], mentionsAndDMs, function(bot, message) {
    gcpBot.listDeployments(bot, message);
  });

  controller.hears(['d(eploy)? new (.*) (.*)'], mentionsAndDMs, function(bot, message) {
    var repo = message.match[2].trim();
    var depFile = message.match[3].trim();
    gcpBot.deployNew(bot, message, repo, depFile);
  });

  controller.hears(['m(onitor)? m(etrics)?(.*)?'], mentionsAndDMs, function(bot, message) {
    var metricString = message.match[3];
    gcpBot.monitorMetrics(bot, message, metricString);
  });

  controller.hears(['m(onitor)? p(ack)?(.*)?'], mentionsAndDMs, function(bot, message) {
    var metricString = (message.match[3] || '').trim();
    gcpBot.monitorMetricPack(bot, message, metricString);
  });

  controller.hears(['m(onitor)? (.*)?'], mentionsAndDMs, function(bot, message) {
    var metricString = message.match[2];
    gcpBot.monitor(bot, message, metricString);
  });
  
  controller.hears('.*', mentionsAndDMs, function(bot, message) {
    bot.reply(message, "I don't understand. Try `help` to see what I can do.");
  });
};

Bot.prototype.authorizeAndGetData = function(bot, message) {
  var reply = replier(bot, message);
  var teamId = bot.team_info.id;
  var user = message.user;
  var channel = message.channel;
  return this.authorizeAndGetDataForUser(reply, teamId, user, channel);
};

Bot.prototype.authorizeAndGetDataForUser = function(replier, teamId, user, channel) {
  var self = this;
  return this.botData.getUserChannelData(user, channel).then(function(userData) {
    var gcpClient = new GCPClient(self.authCache, user, userData, teamId, replier);
    return gcpClient.authorize().then(function(auth) {
      if(auth) {
        gcpClient.auth = auth;
        return gcpClient;
      } else {
        return Promise.reject();
      }
    });
  });
};

Bot.prototype.setProjectFromList = function(bot, message, searchText) {
  var self = this;
  this.authorizeAndGetData(bot, message).then(function(gcpClient) {
    return gcpClient.getProjects().then(function(projects) {
      // If the user asked for a project they have, use that
      var found = findProject(searchText, projects);
      if(found) {
        setProject(self.botData, bot, message, found.projectId);
      // Otherwise, start a conversation with them to help them pick one
      } else {
        self.startProjectChoiceConversation(bot, message, projects, true, 'Your GCP account does not have a project `' + searchText + '`. Which would you like to use?');
        bot.reply(message, buildProjectList(projects));
      }
    });
  }).catch(catchAll);
};

Bot.prototype.listProjects = function(bot, message) {
  var self = this;
  this.authorizeAndGetData(bot, message).then(function(gcpClient) {
    var userData = gcpClient.userData;
    return gcpClient.getProjects().then(function(projects) {
      bot.reply(message, buildProjectList(projects));
      
      // If there's only one project, set it as the project for this channel.
      if(projects && projects.length == 1 && !userData.projectId) {
        setProject(self.botData, bot, message, projects[0].projectId);
      // If there is no project setup and more than one project, ask the user to pick
      } else {
        if(!userData.projectId) {
          self.startProjectChoiceConversation(bot, message, projects, true, 'You have not set a project to use in this channel. Which would you like to use?');
        // If there's a project set up give the user a chance to change it
        } else {
          self.startProjectChoiceConversation(bot, message, projects, false, 'You are using `' + userData.projectId + '` in this channel. To change projects, reply with a project name or id.');
        }
      }
    });
  }).catch(catchAll);
};

Bot.prototype.startProjectChoiceConversation = function(bot, message, projects, shouldRepeat, question) {
  var self = this;
  bot.startConversation(message, function(err, convo) {
    var repeated = false;
    convo.ask(question, function(response, convo) {
      var responseText = Utils.getResponseText(bot, response);
      var found = findProject(responseText, projects);
      if(found) {
        setProject(self.botData, bot, message, found.projectId);
      } else if(shouldRepeat) {
        self.startProjectChoiceConversation(bot, message, projects, false, "Your GCP account does not have a project `" + responseText + "`. Which project would you like to use?");
      } else {
        convo.say("Your GCP account does not have a project `" + responseText + "`. I give up. You can use `project <projectId>` to set your project at any time.");
      }
      convo.next();
    });
  });
};

Bot.prototype.schedule = function(bot, message, projectSearch, scheduleString, metricPack) {
  metricPack = metricPack || 'simple';
  var self = this;
  // Fetch the user data so we know the time zone
  self.botData.fetchUserInfo(message.user, bot).then(function(userInfo) {
    self.authorizeAndGetData(bot, message).then(function(gcpClient) {
      return gcpClient.getProjects().then(function(projects) {
        var foundProject = findProject(projectSearch, projects);
        if(!foundProject) {
          bot.reply(message, "Your GCP account does not have a project `" + projectSearch + "` so I did not schedule the digest. Try `project` to see a list of projects for your account.");
          return;
        }
        var projectId = foundProject.projectId;
        
        // First do the actual scheduling
        var tz = userInfo.user.tz;
        var scheduleData = {
            teamId: bot.team_info.id,
            projectId: projectId,
            schedule: scheduleString,
            metricPack: metricPack,
            tz: tz
        };
        var success = self.scheduleDigest(message.user, message.channel, scheduleData);
        
        if(success) {
          // Then save the data so it can be used later (especially on bot restart)
          var channelData = { schedule: scheduleData };
          self.botData.saveUserChannelData(message.user, message.channel, channelData);
          bot.reply(message, 'Ok, I scheduled a `' + projectId + '` digest at `' + scheduleString + '` in this channel. Showing `' + metricPack + '` metrics.');
        } else {
          // Or tell the user that the scheduling failed
          bot.reply(message, 'I could not schedule a digest for `' + scheduleString + '`. Is something wrong with your cron string?');
        }  
      });
    });
  }, function(err) {
    bot.reply(message, 'Are you a real person?');
  }).catch(catchAll);
};

Bot.prototype.unschedule = function(bot, message) {
  var self = this;
  self.botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    if(userData.schedule) {
      var projectId = userData.schedule.projectId;
      self.scheduler.cancel(message.user + message.channel + projectId);
      delete userData.schedule;
      return self.botData.saveUserChannelData(message.user, message.channel, userData, false).then(function() {
        bot.reply(message, 'Ok, your digest for `' + projectId + '` has been cancelled.');
      });
    } else {
      bot.reply(message, 'You have no digest scheduled. Use `schedule <projectId>` to schedule one.');
    }
  }, function(err) {
    console.error('Error unscheduling digest:', err);
    bot.reply(message, 'I could not unschedule this digest.');
  }).catch(catchAll);
};

Bot.prototype.showDigest = function(bot, message) {
  this.showScheduledDigest(message.user, bot.team_info.id, message.channel).catch(catchAll);
};

Bot.prototype.showDeployDetail = function(bot, message, depId) {
  this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
    return gcpClient.showDeployDetail(depId);
  }).catch(catchAll);
};

Bot.prototype.showDeploySummary = function(bot, message, email) {
  this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
    return gcpClient.showDeploySummary(email);
  }).catch(catchAll);
};

Bot.prototype.listDeployments = function(bot, message) {
  this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
    return gcpClient.showDeployList();
  }).catch(catchAll);
};

Bot.prototype.deployNew = function(bot, message, repo, depFile) {
  this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
    return gcpClient.newDeploy(repo, depFile);
  }).catch(catchAll);
};

Bot.prototype.monitorMetrics = function(bot, message, metricString) {
  this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
    var parsedMetrics = parseMetricsFromMessage(metricString);
    return gcpClient.listMetrics(parsedMetrics);
  }).catch(catchAll);
};

Bot.prototype.monitorMetricPack = function(bot, message, metricString) {
  // First see if there's a named package
  if(Metrics.packages[metricString]) {
    this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
      return gcpClient.monitorMetricPack(metricString);
    }).catch(catchAll);
  } else {
    var packages = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
    bot.reply(message, 'Metric pack name is required. Try one of: ' + packages);
  }
};

Bot.prototype.monitor = function(bot, message, metricString) {
  var metrics = parseMetricsFromMessage(metricString);
  if (metrics) {
    this.authorizeAndGetData(bot, message).then(checkForProject).then(function(gcpClient) {
      return gcpClient.monitorMetricList(metrics);
    }).catch(catchAll);
  } else {
    bot.reply(message, "Metrics are required.");
  }
};

Bot.prototype.showScheduledDigest = function (user, teamId, channel) {
  var self = this;
  var bot = bots[teamId];
  if(!bot) {
    console.error('No bot for scheduled digest. Team:', teamId);
    return Promise.reject();
  }
  var say = sayer(bot, user, channel);
  return this.authorizeAndGetDataForUser(say, teamId, user, channel).then(function(gcpClient) {
    var userData = gcpClient.userData;
    if(userData && userData.schedule) {
      // Use the project id from the digest instead of the channel data
      gcpClient.userData.projectId = userData.schedule.projectId;
      var metricPack = userData.schedule.metricPack || 'simple';
      return gcpClient.monitorMetricPack(metricPack);
    } else {
      say("You do not have a scheduled digest in this channel.");
      console.error("Trying to run digest with no data. User:", user, "Channel:", channel);
    }
  }).catch(catchAll);
};

Bot.prototype.scheduleDigest = function(user, channel, scheduleData) {
  var self = this;
  return self.scheduler.scheduleInterval(user + channel + scheduleData.projectId, scheduleData.schedule, scheduleData.tz, function() {
    self.showScheduledDigest(user, scheduleData.teamId, channel);
  });
};

Bot.prototype.connect = function(controller, slackToken) {
  var self = this;
  if(slackToken) {
    console.log('Connecting to single slack team');
    var bot = controller.spawn({
      token: slackToken
    });
    
    bot.startRTM(function(err, bot, payload) {
      if (err) {
        throw new Error('Could not connect to Slack');
      }
      self.botData.fetchBotIdentity(bot, bot.identity.id);
      bots[bot.team_info.id] = bot;
    });
  } else {
    var beepboop = BeepBoop.start(controller);
    console.log('Connecting to BeepBoop resourcer');
    beepboop.on('add_resource', function(msg) {
      var resource = beepboop.workers[msg.resourceID];
      if(resource) {
        self.botData.fetchBotIdentity(resource.worker, resource.resource.SlackBotUserID);
        var teamId = resource.resource.SlackTeamID;
        bots[teamId] = resource.worker;
      } else {
        console.error('No bot found when added to team.');
      }
    });
  }
};

function formatObject(obj) {
  var message = {
    fields: []
  };
  if(typeof obj === "string") {
    message.text = obj;
  } else if(typeof obj === "object") {
    for(var attr in obj) {
      var value = obj[attr];
      if(Array.isArray(value) || typeof value === "object") {
        value = JSON.stringify(value);
      }
      message.fields.push({title: attr, value: value, short: value.length <= 80 });
    }
  } else {
    message.text = JSON.stringify(obj);
  }
  return message;
}

Bot.prototype.runScript = function(bot, message, script) {
  // TODO: save script and enable running it later
  return this.authorizeAndGetData(bot, message).then(function(gcpClient) {
    return gcpClient.runScript(script).then(function(result) {
      var reply = { text: "Results:" };
      if(Array.isArray(result)) {
        reply.attachments = [];
        for(var i = 0; i < result.length; i++) {
          reply.attachments.push(formatObject(result[i]));
        }
        if(reply.attachments.length === 0) {
          reply.attachments = [{ text: "[]" }];
        }
      } else {
        reply.attachments = [formatObject(result)];
      }
      
      bot.reply(message, reply);
    }, function(err) {
      bot.reply(message, "Something went wrong. :/ `" + err.message + "`");
    });
  });
};

Bot.prototype.scheduleExistingDigests = function() {
  var self = this;
  // Schedule all jobs that were saved
  return this.botData.getAllUserData().then(function(allData) {
    for(var i = 0; i < allData.length; i++) {
      var data = allData[i];
      var user = data.id;
      for(var channel in data.channels) {
        var channelData = data.channels[channel];
        if(channelData && channelData.schedule) {
          console.log('scheduling user:', user, 'team:', channelData.schedule.teamId, 'channel:', channel, 'project:', channelData.schedule.projectId, 'schedule:', channelData.schedule.schedule, 'metricPack:', channelData.schedule.metricPack, 'timezone:', channelData.schedule.tz);
          var result = self.scheduleDigest(user, channel, channelData.schedule);
          if(!result) {
            console.error('scheduling failed');
          }
        }
      }
    }
  }).catch(function(err) {
    console.error("Error scheduling digests:", err);
  });
};

module.exports = Bot;
